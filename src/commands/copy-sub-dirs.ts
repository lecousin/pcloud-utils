import fs from 'node:fs';
import path from 'node:path';
import { CompositeProgress, MultipleProgress, SingleProgress, SingleProgressWrapper } from '../progress/progress.js';
import { ZipArchive } from 'archiver';
import { retry } from '../utils/retry.js';
import { PCloudClient } from '../pcloud/pcloud-client.js';

export async function copySubDirs(localDir: string, pcloudDir: string, pcloudKey: string) {
    await new CopySubDirsCommand(localDir, pcloudDir, pcloudKey).start();
}

interface FileToProcess {
    filename: string;
    path: string;
    size: number;
}

class CopySubDirsCommand {
    constructor(
        private readonly localDir: string,
        private readonly pcloudDir: string,
        pcloudKey: string,
    ) {
        this.pcloud = new PCloudClient('https://eapi.pcloud.com', pcloudKey);
    }

    private readonly pcloud: PCloudClient;

    public async start() {
        const title = 'Copying from ' + this.localDir + ' to ' + this.pcloudDir;
        const progress = new MultipleProgress(title + '...', 20, 1000);
        const srcDir = await fs.promises.opendir(this.localDir);
        let subDirEntry;
        let nbSubDirs = 0;
        while ((subDirEntry = await srcDir.read()) !== null) {
            if (!subDirEntry.isDirectory()) continue;
            if (subDirEntry.name.startsWith('.')) continue;
            const index = ++nbSubDirs;
            this.processSubDir(subDirEntry.name, index, progress);
            progress.setTitle(title + ' (' + index + '+)');
        }
        await srcDir.close();
        progress.setTitle(title + ' (' + nbSubDirs + ')');
        await progress.waitDone();
    }

    public processSubDir(subDir: string, subDirIndex: number, globalProgress: MultipleProgress) {
        // TODO launch as soon as possible the mkdir on PCloud
        let listFiles: SingleProgress;
        let createZipProgress: SingleProgress;
        let uploadProgress: SingleProgress;
        let extractProgress: SingleProgress;
        let cleaningProgress: SingleProgress;
        const fullProgress = globalProgress.newProgress(onRefresh => {
            const p = new CompositeProgress(subDirIndex + ' (' + subDir + ')');
            listFiles = p.addSubWork(new SingleProgress(onRefresh));
            listFiles.reset('Listing files', 1000);
            createZipProgress = p.addSubWork(new SingleProgress(onRefresh));
            createZipProgress.reset('Create zip', 10000);
            uploadProgress = p.addSubWork(new SingleProgress(onRefresh));
            uploadProgress.reset('Upload', 25000);
            extractProgress = p.addSubWork(new SingleProgress(onRefresh));
            extractProgress.reset('Extract', 1000000);
            cleaningProgress = p.addSubWork(new SingleProgress(onRefresh));
            cleaningProgress.reset('Cleaning', 1000);
            return p;
        }, () => {
            const srcDir = fs.opendirSync(path.join(this.localDir,  subDir));
            let files: FileToProcess[] = [];
            let entry: fs.Dirent<string> | null;
            let totalSize = 0;
            while ((entry = srcDir.readSync()) !== null) {
                if (entry.isFile()) {
                    const stat = fs.statSync(path.join(this.localDir, subDir, entry.name));
                    files.push({filename: entry.name, path: path.join(this.localDir, subDir, entry.name), size: stat.size});
                    totalSize += stat.size;
                }
            }
            srcDir.closeSync();
            createZipProgress.reset('Create zip', totalSize / 10);
            uploadProgress.reset('Upload', totalSize / 4);
            extractProgress.reset('Extract', totalSize * 10);
            listFiles.done();
            retry((fullTrial) => {
                fullProgress.setTitle(subDirIndex + ' (' + subDir + ' ' + files.length + ' files) try ' + fullTrial)
                fullProgress.restart();
                listFiles.done();
                createZipProgress.resetWorkDone();
                uploadProgress.resetWorkDone();
                extractProgress.resetWorkDone();
                cleaningProgress.resetWorkDone();
                const zipFilename = 'tmp_' + subDir + '.zip';
                return this.createZip(files, totalSize, zipFilename, createZipProgress)
                .then(() => retry((uploadTrial) => {
                    uploadProgress.reset('Upload try ' + uploadTrial, totalSize / 4);
                    extractProgress.reset('Extract try ' + uploadTrial, totalSize * 10);
                    return this.uploadZip(zipFilename, uploadProgress)
                    .then(() => retry((extractTrial) => {
                        extractProgress.reset('Extract try ' + uploadTrial + '/' + extractTrial, totalSize * 10);
                        return this.extractZip(zipFilename, subDir, files.length, extractProgress);
                    }, 30, 1000));
                }, 5, 1000))
                .then(() => this.cleaning(zipFilename, cleaningProgress));
            }, 10, 100)
            .catch(e => {
                console.error('Error on directory ' + subDir, e);
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
                archive.file(file.path, { name: file.filename });
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

    private async extractZip(zipFilename: string, subDir: string, nbFiles: number, progress: SingleProgress) {
        progress.resetWorkDone();
        progress.addWorkDone(1);
        await this.pcloud.mkdir(this.pcloudDir + '/' + subDir, false);
        progress.addWorkDone(1);
        await this.pcloud.extractFile(this.pcloudDir + '/' + zipFilename, this.pcloudDir + '/' + subDir, nbFiles, progress);
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