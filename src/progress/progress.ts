import { MultiLineStdout } from '../utils/mult-line-stdout.js';
import { durationToString } from '../utils/time-utils.js';

export interface Progress {
    get isDone(): boolean;
    get totalAmount(): number;
    get doneAmount(): number;
    get title(): string;

    waitDone(): Promise<any>;

    generateSimpleProgress(): string;
    generateLines(lines: string[], indent: number): void;
}

function doIndent(indent: number): string {
    let s = '';
    for (let i = 0; i < indent; ++i) s += '  ';
    return s;
}

function generateProgress(title: string, done: boolean, workAmount: number, workDone: number, startTime: number | undefined): string {
    let s = title + ' ';
    if (done) {
        s += '✅';
        return s;
    }
    s += '[';
    const pc = workAmount > 0 ? workDone * 20 / workAmount : 0;
    for (let i = 0; i < 20; ++i) {
        if (pc >= (i + 1)) s += '▉';
        else if (pc < i) s += ' ';
        else {
            const a = (pc - i);
            if (a < 0.1) s += ' ';
            else if (a < 0.3) s += '▏';
            else if (a < 0.5) s += '▎';
            else if (a < 0.7) s += '▍';
            else if (a < 0.9) s += '▋';
            else s += '▊';
        }
    }
    s += '] ' + Math.floor(workAmount > 0 ? workDone * 100 / workAmount : 0) + '%';
    if (startTime !== undefined) {
        const now = Date.now();
        const ellapsed = now - startTime;
        const eta = workAmount * ellapsed / workDone;
        s += ' ' + durationToString(ellapsed) + ' - ' + durationToString(eta - ellapsed);
    }
    return s;
}

export class SingleProgress implements Progress {

    constructor(private readonly onRefresh: () => void) {
        this._start = Date.now();
    }

    private _start: number;
    private _title = '';
    private _workAmount = 0;
    private _workDone = 0;
    private _done = false;
    private readonly _doneListeners: (() => void)[] = [];

    public get isDone(): boolean { return this._done; }
    public get totalAmount(): number { return this._workAmount; }
    public get doneAmount(): number { return this._workDone; }
    public get title(): string { return this._title; }

    public reset(title: string = '', workAmount: number = 0): void {
        this._title = title;
        this._workAmount = workAmount;
        this._workDone = 0;
        this._done = false;
        this._start = Date.now();
        this.onRefresh();
    }

    public resetWorkDone(done: number = 0): void {
        this._workDone = done;
        this._done = false;
        this._start = Date.now();
        this.onRefresh();
    }

    public addWorkToDo(amount: number): void {
        this._workAmount += amount;
        this.onRefresh();
    }

    public addWorkDone(amount: number): void {
        this._workDone += amount;
        this.onRefresh();
    }

    public done() {
        if (this._workAmount <= 0) this._workAmount = 1;
        this._workDone = this._workAmount;
        this._done = true;
        const listeners = [...this._doneListeners];
        this._doneListeners.splice(0, this._doneListeners.length);
        for (const listener of listeners) listener();
        this.onRefresh();
    }

    waitDone(): Promise<any> {
        return new Promise(resolve => {
            if (this.isDone) resolve(null);
            else this._doneListeners.push(() => resolve(null));
        });
    }

    public generateSimpleProgress(): string {
        return generateProgress(this._title, this._done, this._workAmount, this._workDone, this._start);
    }

    public generateLines(lines: string[], indent: number): void {
        lines.push(doIndent(indent) + this.generateSimpleProgress());
    }
}

export class SingleProgressWrapper {
    constructor(private readonly progress: SingleProgress, private readonly amount: number) {
        this._initDone = progress.doneAmount;
    }

    private readonly _initDone;
    private _done = 0;
    private _lastSent = 0;

    public addProgress(work: number): void {
        this._done = Math.max(0, Math.min(this._done + work, this.amount));
        this.update();
    }

    public setProgress(work: number): void {
        this._done = Math.max(0, Math.min(work, this.amount));
        this.update();
    }

    private update(): void {
        const newSent = Math.floor(this._done * (this.progress.totalAmount - this._initDone) / this.amount);
        if (newSent > this._lastSent) {
            this.progress.addWorkDone(newSent - this._lastSent);
            this._lastSent = newSent;
        }
    }
}

export class CompositeProgress implements Progress {

    constructor(title: string = '') {
        this._title = title;
        this._start = Date.now();
    }

    private _title: string;
    private _start: number;
    private readonly _subProgresses: Progress[] = [];
    private readonly _doneListeners: (() => void)[] = [];

    public restart(): void {
        this._start = Date.now();
    }

    public addSubWork<T extends Progress>(progress: T): T {
        this._subProgresses.push(progress);
        progress.waitDone().then(() => this.checkDone());
        return progress;
    }

    public setTitle(title: string): void {
        this._title = title;
    }

    get totalAmount(): number {
        let total = 0;
        for (const p of this._subProgresses) total += p.totalAmount;
        return total;
    }

    get doneAmount(): number {
        let total = 0;
        for (const p of this._subProgresses) total += p.doneAmount;
        return total;
    }

    get title(): string {
        return this._title;
    }

    get isDone(): boolean {
        for (const p of this._subProgresses) if (!p.isDone) return false;
        return true;
    }

    generateSimpleProgress(): string {
        return generateProgress(this._title, this.isDone, this.totalAmount, this.doneAmount, this._start);
    }

    generateLines(lines: string[], indent: number): void {
        lines.push(doIndent(indent) + this.generateSimpleProgress());
        for (const p of this._subProgresses) if (!p.isDone && p.doneAmount > 0) p.generateLines(lines, indent + 1);
    }

    waitDone(): Promise<any> {
        return new Promise(resolve => {
            if (this.isDone) resolve(null);
            else this._doneListeners.push(() => resolve(null));
        });
    }

    private checkDone(): void {
        if (this._doneListeners.length === 0 || !this.isDone) return;
        const listeners = [...this._doneListeners];
        this._doneListeners.splice(0, this._doneListeners.length);
        for (const listener of listeners) listener();
    }
}

export class MultipleProgress implements Progress {

    constructor(
        private _title: string,
        private readonly maxConcurrency: number,
        minRefreshTime: number = 1000,
    ) {
        this._printer = new MultiLineStdout(minRefreshTime, () => {
            const lines: string[] = [];
            this.generateLines(lines, 0);
            return lines;
        });
        this._start = Date.now();
    }

    private readonly _start: number;
    private readonly _printer: MultiLineStdout;
    private readonly _activeProgresses: Progress[] = [];
    private readonly _waitingProgresses: {progress: Progress, onStart: () => void}[] = [];
    private readonly _doneProgresses: Progress[] = [];
    private readonly _waitingDone: (() => void)[] = [];

    public setTitle(title: string): void {
        this._title = title;
        this._printer.refresh();
    }

    public newProgress<T extends Progress>(creator: (onRefresh: () => void) => T, onStart: () => void): T {
        const progress = creator(() => this._printer.refresh());
        progress.waitDone().then(() => this.checkWaiting());
        this._waitingProgresses.push({progress, onStart});
        setTimeout(() => {
            this.checkWaiting();
        }, 0);
        this._printer.refresh();
        return progress;
    }

    private checkWaiting() {
        let changed = false;
        for (let i = 0; i < this._activeProgresses.length; ++i) {
            const active = this._activeProgresses[i]!;
            if (active.isDone) {
                this._doneProgresses.push(active);
                this._activeProgresses.splice(i, 1);
                i--;
                changed = true;
            }
        }
        let waiting: {progress: Progress, onStart: () => void} | undefined;
        while (this._activeProgresses.length < this.maxConcurrency && (waiting = this._waitingProgresses.shift()) !== undefined) {
            this._activeProgresses.push(waiting.progress);
            waiting.onStart();
            changed = true;
        }
        if (changed) this._printer.refresh();
        if (this._activeProgresses.length === 0) {
            const listeners = [...this._waitingDone];
            this._waitingDone.splice(0, this._waitingDone.length);
            for (const listener of listeners) listener();
        }
    }

    get title(): string {
        return this._title;
    }

    get totalAmount(): number {
        let total = 0;
        for (const p of this._doneProgresses) total += p.totalAmount;
        for (const p of this._activeProgresses) total += p.totalAmount;
        for (const p of this._waitingProgresses) total += p.progress.totalAmount;
        return total;
    }

    get doneAmount(): number {
        let total = 0;
        for (const p of this._doneProgresses) total += p.totalAmount;
        for (const p of this._activeProgresses) total += p.doneAmount;
        return total;
    }

    get isDone(): boolean {
        if (this._waitingProgresses.length > 0) return false;
        if (this._activeProgresses.length > 0) return false;
        return true;
    }

    generateSimpleProgress(): string {
        return generateProgress(this._title, this.isDone, this.totalAmount, this.doneAmount, this._start);
    }

    generateLines(lines: string[], indent: number): void {
        lines.push(doIndent(indent) + this.generateSimpleProgress());
        if (this._activeProgresses.length > 0) {
            for (const p of this._activeProgresses) p.generateLines(lines, indent + 1);
        } else if (this._waitingProgresses.length > 0) {
            this._waitingProgresses[0]?.progress.generateLines(lines, indent + 1);
        } else if (this._doneProgresses.length > 0) {
            this._doneProgresses.at(-1)?.generateLines(lines, indent + 1);
        }
    }

    public waitDone(): Promise<any> {
        return new Promise(resolve => {
            if (this.isDone) resolve(null);
            else this._waitingDone.push(() => resolve(null));
        });
    }
}

export class ProgressMultiActivity {

    constructor(private readonly title: string, refreshMinTime: number = 1000) {
        this.printer = new MultiLineStdout(refreshMinTime, () => this.generateLines());
    }

    private readonly printer: MultiLineStdout;
    private readonly activities: ProgressActivity[] = [];

    public newActivity(title: string, maxConcurrency: number): ProgressActivity {
        const a = new ProgressActivity(title, maxConcurrency, () => this.printer.refresh());
        this.activities.push(a);
        this.printer.refresh();
        return a;
    }

    public async waitDone() {
        const promises: Promise<any>[] = [];
        for (const a of this.activities) {
            for (const op of a.currentOps)
                promises.push(op.op);
        }
        if (promises.length === 0) return;
        await Promise.all(promises);
        await new Promise(resolve => setTimeout(() => this.waitDone().then(resolve), 5000));
    }

    private generateLines(): string[] {
        const lines: string[] = [this.title];
        for (const a of this.activities) this.generateActivityLines(a, lines);
        return lines;
    }

    private generateActivityLines(activity: ProgressActivity, lines: string[]): void {
        lines.push(' + ' + activity.title);
        if (activity.done.length > 0) {
            lines.push('   ✅ ' + (activity.done.length > 1 ? activity.done.length : activity.done[0]));
        }
        for (const op of activity.currentOps) {
            lines.push('   ⚙️ ' + op.title + ' ' + op.progress.generateSimpleProgress());
        }
        if (activity.waitingOps.length > 0) {
            lines.push('   ⌛ ' + (activity.waitingOps.length > 1 ? activity.waitingOps.length : activity.waitingOps[0]!.title));
        }
    }

}

export class ProgressActivity {

    constructor(public readonly title: string, private readonly maxConcurrency: number, private readonly onRefresh: () => void) {}

    currentOps: CurrentOperation[] = [];
    readonly done: string[] = [];
    readonly waitingOps: WaitingOperation[] = [];
    private readonly waitingSignals: (() => boolean)[] = [];

    public pushOperation(title: string, op: (progress: Progress) => Promise<any>) {
        this.waitingOps.push({title, op});
        if (this.currentOps.length < this.maxConcurrency) this.startNextOp(); else this.onRefresh();
    }

    public async waitLessThan(maxPending: number) {
        if (this.waitingOps.length < maxPending) return;
        return new Promise(resolve => {
            this.waitingSignals.push(() => {
                if (this.waitingOps.length < maxPending) {
                    resolve(null);
                    return true;
                }
                return false;
            });
        });
    }

    private startNextOp() {
        if (this.currentOps.length >= this.maxConcurrency) {
            this.onRefresh();
            this.signals();
            return;
        }
        const next = this.waitingOps.shift();
        if (!next) {
            this.onRefresh();
            this.signals();
            return;
        }
        const progress = new SingleProgress(this.onRefresh);
        const op = next.op(progress);
        this.currentOps.push({title: next.title, op, progress});
        this.signals();
        op
        .catch(e => {
            console.error('Error doing', next.title, e);
            process.exit(1);
        })
        .finally(() => {
            this.done.push(next.title);
            const currentIndex = this.currentOps.findIndex(o => o.op === op);
            this.currentOps.splice(currentIndex, 1);
            this.startNextOp();
            progress.done();
        });
        this.onRefresh();
    }

    private signals(): void {
        for (let i = 0; i < this.waitingSignals.length; ++i) {
            if (this.waitingSignals[i]!()) {
                this.waitingSignals.splice(i, 1);
                --i;
            }
        }
    }

}

interface WaitingOperation {
    title: string;
    op: (progress: Progress) => Promise<any>;
}

interface CurrentOperation {
    title: string;
    op: Promise<any>;
    progress: Progress;
}