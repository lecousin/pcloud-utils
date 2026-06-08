export function retry<T>(op: (trial: number) => Promise<T>, times: number, delay: number): Promise<T> {
    return new Promise<T>((resolve, reject) => doRetry(op, 1, times, delay, resolve, reject));
}

function doRetry<T>(op: (trial: number) => Promise<T>, trial: number, times: number, delay: number, resolve: (result: T) => void, reject: (reason?: any) => void): void {
    op(trial)
    .then(resolve)
    .catch(error => {
        if (trial >= times) reject(error);
        else {
            for (let y = 0; y < Math.min(process.stdout.rows, 5); ++y) {
                process.stdout.cursorTo(0, y);
                process.stdout.clearLine(1);
            }
            process.stdout.cursorTo(0, 0);
            console.warn(error);
            process.stdout.clearLine(1);
            console.log('');
            process.stdout.clearLine(1);
            process.stdout.cursorTo(0, process.stdout.rows - 1);
            setTimeout(() => doRetry(op, trial + 1, times, delay, resolve, reject), delay * trial);
        }
    });
}