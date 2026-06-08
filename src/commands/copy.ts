import fs from 'node:fs';
import path from 'node:path';
import { CompositeProgress, MultipleProgress, SingleProgress, SingleProgressWrapper } from '../progress/progress.js';
import { ZipArchive } from 'archiver';
import { retry } from '../utils/retry.js';
import { PCloudClient } from '../pcloud/pcloud-client.js';

export async function copy(localDir: string, pcloudDir: string, pcloudKey: string) {
    await new CopyCommand(localDir, pcloudDir, pcloudKey).start();
}

interface FileToProcess {
    filename: string;
    size: number;
}

class CopyCommand {
    constructor(
        private readonly localDir: string,
        private readonly pcloudDir: string,
        private readonly pcloudKey: string,
    ) {
        this.pcloud = new PCloudClient('https://eapi.pcloud.com', pcloudKey);
    }

    private readonly pcloud: PCloudClient;

    public async start() {
        const title = 'Copying from ' + this.localDir + ' to ' + this.pcloudDir;
        const progress = new MultipleProgress(title + '...', 15, 1000);
        const srcDir = await fs.promises.opendir(this.localDir);
        let filesBunch: FileToProcess[] = [];
        let entry: fs.Dirent<string> | null;
        let nbBunches = 0;
        let totalFiles = 0;
        while ((entry = await srcDir.read()) !== null) {
            if (entry.isFile() && !entry.name.startsWith('tmp_zip_')) {
                const stat = await fs.promises.stat(path.join(this.localDir, entry.name));
                filesBunch.push({filename: entry.name, size: stat.size});
                if (filesBunch.length >= 1000) {
                    totalFiles += filesBunch.length;
                    this.processFiles(filesBunch, ++nbBunches, progress);
                    progress.setTitle(title + ' (' + totalFiles + '+)');
                    filesBunch = [];
                }
            }
        }
        if (filesBunch.length > 0) {
            totalFiles += filesBunch.length;
            this.processFiles(filesBunch, ++nbBunches, progress);
            filesBunch = [];
        }
        progress.setTitle(title + ' (' + totalFiles + ')');
        await srcDir.close();
        await progress.waitDone();
    }

    private processFiles(files: FileToProcess[], bunchNum: number, parentProgress: MultipleProgress) {
        let totalSize = 0;
        for (const f of files) totalSize += f.size;
        let createZipProgress: SingleProgress;
        let uploadProgress: SingleProgress;
        let extractProgress: SingleProgress;
        let cleaningProgress: SingleProgress;
        const fullProgress = parentProgress.newProgress(onRefresh => {
            const p = new CompositeProgress('Bunch ' + bunchNum + ' (' + files.length + ' files)');
            createZipProgress = p.addSubWork(new SingleProgress(onRefresh));
            createZipProgress.reset('Create zip', totalSize / 10);
            uploadProgress = p.addSubWork(new SingleProgress(onRefresh));
            uploadProgress.reset('Upload', totalSize / 4);
            extractProgress = p.addSubWork(new SingleProgress(onRefresh));
            extractProgress.reset('Extract', totalSize * 10);
            cleaningProgress = p.addSubWork(new SingleProgress(onRefresh));
            cleaningProgress.reset('Cleaning', 1000);
            return p;
        }, () => {
            const zipFilename = 'tmp_zip_' + bunchNum + '.zip';
            retry(() => {
                fullProgress.restart();
                createZipProgress.resetWorkDone();
                uploadProgress.resetWorkDone();
                extractProgress.resetWorkDone();
                cleaningProgress.resetWorkDone();
                return this.createZip(files, totalSize, zipFilename, createZipProgress)
                .then(() => retry(() => {
                    uploadProgress.resetWorkDone();
                    extractProgress.resetWorkDone();
                    return this.uploadZip(zipFilename, uploadProgress)
                    .then(() => retry(() => {
                        extractProgress.resetWorkDone();
                        return this.extractZip(zipFilename, files.length, extractProgress);
                    }, 3, 5000));
                }, 3, 1000))
                .then(() => this.cleaning(zipFilename, cleaningProgress));
            }, 5, 100)
            .catch(e => {
                console.error('Error on bunch ' + bunchNum, e);
                process.exit(1);
            });
        });
    }

    private async createZip(files: FileToProcess[], totalSize: number, zipFile: string, progress: SingleProgress) {
        progress.resetWorkDone();
        const zipPath = path.join(this.localDir, zipFile);
        if (fs.existsSync(zipPath)) await fs.promises.unlink(zipPath);
        const output = fs.createWriteStream(zipPath);
        const archive = new ZipArchive({zlib: { level: 9 }});
        const progressWrapper = new SingleProgressWrapper(progress, totalSize);
        return new Promise<any>((resolve, reject) => {
            output.on('close', () => {
                setTimeout(() => {
                    progress.done();
                    resolve(null);
                }, 1000);
            });
            archive.on('error', err => reject(err));
            archive.pipe(output);
            archive.on('entry', e => {
                const f = files.find(f => f.filename === e.name);
                if (f) progressWrapper.addProgress(f.size);
                else console.warn('Entry unknown', e);
            });
            for (const file of files) {
                archive.file(path.join(this.localDir, file.filename), { name: file.filename });
            }
            archive.finalize();
        });
    }

    private async uploadZip(zipFilename: string, progress: SingleProgress) {
        progress.resetWorkDone();
        const buffer = await fs.promises.readFile(path.join(this.localDir, zipFilename));
        const blob = new Blob([buffer]);
        await this.pcloud.uploadFile(blob, this.pcloudDir, zipFilename, progress);
    }

    private async extractZip(zipFilename: string, nbFiles: number, progress: SingleProgress) {
        progress.resetWorkDone();
        await this.pcloud.extractFile(this.pcloudDir + '/' + zipFilename, this.pcloudDir, nbFiles, progress);
    }

    private async cleaning(zipFilename: string, progress: SingleProgress) {
        progress.resetWorkDone();
        const progressWrapper = new SingleProgressWrapper(progress, 2);
        await fs.promises.unlink(path.join(this.localDir, zipFilename));
        progressWrapper.addProgress(1);
        await this.pcloud.deleteFile(this.pcloudDir + '/' + zipFilename);
        progressWrapper.addProgress(1);
        progress.done();
    }

}