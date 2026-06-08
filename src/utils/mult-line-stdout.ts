export class MultiLineStdout {

    constructor(
        private readonly refreshMinTime: number,
        private readonly generator: () => string[],
    ) {}

    private _lastLines: string[] = [];
    private _lastRefresh = 0;
    private _refreshTimeout: any = undefined;

    public refresh() {
        if (this._refreshTimeout) return;
        const now = Date.now();
        const waitTime = Math.max(10, this.refreshMinTime - (now - this._lastRefresh));
        this._refreshTimeout = setTimeout(() => {
            this._lastRefresh = Date.now();
            this._refreshTimeout = undefined;
            this.doRefresh();
        }, waitTime);
    }

    private doRefresh() {
        const newLines = this.generator();
        const toPrint = [...newLines];
        while (toPrint.length < this._lastLines.length) toPrint.splice(0, 0, '');
        if (this._lastLines.length > 1)
            process.stdout.moveCursor(0, -(this._lastLines.length - 1));
        for (let i = 0; i < toPrint.length; ++i) {
            if (i >= this._lastLines.length)
                process.stdout.write('\n');
            else if (i > 0)
                process.stdout.moveCursor(0, 1);
            if (i < this._lastLines.length && toPrint[i] === this._lastLines[i]) continue;
            process.stdout.cursorTo(0);
            process.stdout.clearLine(1);
            process.stdout.cursorTo(0);
            process.stdout.write(toPrint[i]!);
        }
        this._lastLines = newLines;
    }

}