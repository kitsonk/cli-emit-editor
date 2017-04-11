import { Command, Helper, OptionsHelper } from '@dojo/cli/interfaces';
import * as path from 'path';
import { Argv } from 'yargs';
import emitProject from './emitProject';
const pkgDir = require('pkg-dir');

export interface EmitArgs extends Argv {
	content: string | undefined;
	out: string;
	project: string;
	verbose: boolean;
}

function buildNpmDependencies(): { [ pkg: string ]: string } {
	try {
		const packagePath = pkgDir.sync(__dirname);
		const packageJsonFilePath = path.join(packagePath, 'package.json');
		const packageJson = <any> require(packageJsonFilePath);

		return packageJson.dependencies;
	}
	catch (e) {
		throw new Error('Failed reading dependencies from "package.json" - ' + e.message);
	}
}

const command: Command = {
	description: 'Emit an editor bundle for the project.',

	register(options: OptionsHelper) {
		options('c', {
			alias: 'content',
			describe: 'A comma seperated list of extentions of files to include in the project files.  Defaults to "ts,html,css,json,xml,md".',
			type: 'string'
		});

		options('o', {
			alias: 'out',
			describe: 'The output path for the generated bundle.  Defaults to the current working directory.',
			type: 'string',
			default: '.'
		});

		options('p', {
			alias: 'project',
			describe: 'The path to the root of the project to bunde.  Defaults to the current working directory.',
			type: 'string',
			default: '.'
		});

		options('v', {
			alias: 'verbose',
			describe: 'Provide verbose output when generating the editor bundle.',
			default: false
		});
	},

	async run(helper: Helper, args: EmitArgs) {
		return emitProject(args);
	},

	eject(helper: Helper) {
		return {
			npm: {
				devDependencies: {
					...buildNpmDependencies()
				}
			}
		};
	}
};

export default command;
