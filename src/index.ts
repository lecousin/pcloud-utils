import { copySubDirs } from './commands/copy-sub-dirs.js';
import { copy } from './commands/copy.js';

let cmd: Promise<any> = Promise.resolve();

function usage(usage: string) {
    console.log('Usage: ' + usage);
    process.exit(1);
}

switch (process.argv[2]) {
    case 'copy':
        if (process.argv.length < 6) usage('copy <local_dir> <pcloud_dir> <pcloud_key>');
        cmd = copy(process.argv[3]!, process.argv[4]!, process.argv[5]!);
        break;
    case 'copy-sub-dirs':
        if (process.argv.length < 6) usage('copy-sub-dirs <local_dir> <pcloud_dir> <pcloud_key>');
        cmd = copySubDirs(process.argv[3]!, process.argv[4]!, process.argv[5]!);
        break;
    default:
        console.error('Unknown command', process.argv[2]);
        process.exit(1);
}

cmd
.then(() => {
    console.log('Success.');
    process.exit(0);
})
.catch(e => {
    console.error(e);
    process.exit(1);
})