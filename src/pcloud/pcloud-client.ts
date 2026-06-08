import { SingleProgressWrapper, type Progress, type SingleProgress } from '../progress/progress.js';
import crypto from 'node:crypto';

export class PCloudClient {

    constructor(
        private readonly baseUrl: string,
        authKey: string,
    ) {
        this.authParam = 'auth=' + authKey;
    }

    private readonly authParam: string;

    public async uploadFile(content: Blob, pcloudDir: string, pcloudFilename: string, progress: SingleProgress) {
        const total = content.size;
        if (progress.totalAmount === 0)
            progress.reset('Uploading ' + pcloudFilename, total);
        const progresshash = crypto.createHash('md5').update(pcloudDir + '/' + pcloudFilename).update('' + Date.now()).digest('hex');
        const fetchPromise = fetch(this.baseUrl + '/uploadfile?' + this.authParam + '&path=' + pcloudDir + '&filename=' + pcloudFilename + '&progresshash=' + progresshash, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream'
            },
            body: content
        })
        .then(r => r.json() as Promise<{result?: number}>)
        .catch(e => {
            throw new Error('Error uploading file to PCloud ' + pcloudDir + '/' + pcloudFilename, e);
        })
        .then((json) => {
            if (json.result !== 0) throw new Error('Error uploading file to PCloud ' + pcloudDir + '/' + pcloudFilename + ': ' + JSON.stringify(json));
        });
        const progressWrapper = new SingleProgressWrapper(progress, total);
        let waited = 0;
        do {
            const response = await (fetch(this.baseUrl + '/uploadprogress?' + this.authParam + '&progresshash=' + progresshash).then(r => r.json() as {result?: number, uploaded?: number, finished?: boolean}));
            if (response.result === 1900) {
                if (waited > 100) {
                    await fetchPromise;
                    break;
                }
                waited++;
                await new Promise(resolve => setTimeout(() => resolve(null), 100));
                continue;
            }
            if (response.finished) break;
            const done = response.uploaded || 0;
            progressWrapper.setProgress(done);
        } while (true);
        await fetchPromise;
        progress.done();
    }

    public async extractFile(filePath: string, targetDir: string, expectedNbFiles: number, progress: SingleProgress) {
        const progressWrapper = new SingleProgressWrapper(progress, expectedNbFiles + 1);
        const start = Date.now();
        if (!targetDir.endsWith('/')) targetDir += '/';
        const progresshash = await fetch(this.baseUrl + '/extractarchive?' + this.authParam + '&path=' + filePath + '&topath=' + targetDir, {
            method: 'GET',
        }).then(r => r.json() as Promise<{result?: number, lines?: number, finished?: boolean, progresshash?: string}>)
        .then(response => {
            if (response.result !== 0) throw new Error('Error extracting ' + filePath + ' on PCloud: ' + JSON.stringify(response));
            if (response.finished) return undefined;
            if (response.lines) progressWrapper.setProgress(response.lines);
            return response.progresshash;
        });
        if (progresshash) {
            do {
                const response = await (fetch(this.baseUrl + '/extractarchiveprogress?' + this.authParam + '&progresshash=' + progresshash).then(r => r.json() as Promise<{result?: number, lines?: number, finished?: boolean}>));
                if (response.result !== 0) throw new Error('Error extracting ' + filePath + ' on PCloud: ' + JSON.stringify(response));
                if (response.finished) break;
                if (response.lines) progressWrapper.setProgress(response.lines);
                const eta = (expectedNbFiles + 1) * (Date.now() - start) / Math.min(1, response.lines || 1);
                await new Promise(resolve => setTimeout(() => resolve(null), eta > 5000 ? 1500 : eta > 2000 ? 500 : 250));
            } while (true);
        }
        progress.done();
    }

    public async deleteFile(path: string) {
        const response = await fetch(this.baseUrl + '/deletefile?' + this.authParam + '&path=' + path, {
            method: 'GET',
        })
        .then(r => r.json() as Promise<{result?: number}>);
        if (response.result !== 0) throw new Error('Error deleting file on PCloud ' + path + ': ' + JSON.stringify(response));
    }

    public async mkdir(path: string, errorIfAlreadyExists: boolean = true) {
        const response = await fetch(this.baseUrl + '/createfolder?' + this.authParam + '&path=' + path, {
            method: 'GET',
        })
        .then(r => r.json() as Promise<{result?: number}>);
        if (response.result !== 0 && (errorIfAlreadyExists || response.result !== 2004))
            throw new Error('Error creating directory on PCloud ' + path + ': ' + JSON.stringify(response));
    }

}