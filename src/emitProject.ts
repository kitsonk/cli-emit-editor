import { underline, bold } from 'chalk';
import { access, constants, readFile, writeFile } from 'fs';
import * as glob from 'glob';
import { extname, join, normalize, relative } from 'path';
import { chdir, cwd } from 'process';

import { EmitArgs } from './main';
import { ProjectBundle, ProjectFileType, ProjectFile } from './interfaces/editor';
import { JsonSchemaForNpmPackageJsonFiles as PackageJson } from './interfaces/package.json';

/**
 * Including both interface files from @dojo/loader causes issues, therefore we will manually exclude one of
 * them
 */
const DOJO_EXCLUDE = /@dojo\/loader\/interfaces\.d\.ts$/;

export let resolve = require.resolve;

let verboseFlag = false;

/**
 * Log a message to the console, respecting the verbosity flag
 * @param message The message to be logged
 * @param verbose If the logging message is verbose or not
 */
function log(message: any, verbose: boolean = false) {
	if (verbose && !verboseFlag) {
		return;
	}
	console.log(message);
}

/**
 * Helper function to create a new project file entry
 * @param name Name of the file
 * @param text The text of the file
 * @param type The file type
 */
function createProjectFile(name: string, text: string, type: ProjectFileType = ProjectFileType.Definition): ProjectFile {
	return { name, text, type };
}

/**
 * An async function which resolves with an array of files which match the supplied glob pattern.
 * @param pattern The matching pattern to glob
 */
async function getGlob(pattern: string) {
	return new Promise<string[]>((resolve, reject) => {
		glob(pattern, (err, matches) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(matches);
		});
	});
}

/**
 * An async function which loads a file and resolves to its string data
 * @param filename The filename to get
 */
async function getFile(filename: string) {
	return new Promise<string>((resolve, reject) => {
		readFile(filename, 'utf8', (err, data) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(data.toString());
		});
	});
}

/**
 * An async function that resolves to `true` if the file exists and is readable, otherwise `false`
 * @param filename The filename to check existance of
 */
async function exists(filename: string) {
	return new Promise<boolean>((resolve) => {
		access(filename, constants.R_OK, (err) => {
			resolve(err ? false : true);
		});
	});
}

/**
 * An async function which writes out a file
 * @param filename The filename to write out
 * @param contents The contents of the file
 */
async function setFile(filename: string, contents: string) {
	return new Promise<string>((resolve, reject) => {
		writeFile(filename, contents, { encoding: 'utf8' }, (err) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(filename);
		});
	});
}

/**
 * Create the basic project bundle, reading in the `package.json` and `tsconfig.json`
 */
async function createProject() {
	const project: ProjectBundle = {
		environmentFiles: [],
		files: [],
		package: {},
		tsconfig: {}
	};

	if (!(await exists('package.json') && await exists('tsconfig.json'))) {
		throw new Error(`Path "${cwd()}" does not contain a "tsconfig.json" and "package.json".`);
	}

	log('  ' + bold.blue('reading') + ' "package.json"', true);
	Object.assign(project.package, JSON.parse(await getFile('package.json')));
	log('  ' + bold.blue('reading') + ' "tsconfig.json"', true);
	Object.assign(project.tsconfig, JSON.parse(await getFile('tsconfig.json')));

	return project;
}

/**
 * An async function which loads and adds TypeScript libraries files specified in the `tsconfig.json`
 * for the project.
 * @param project The reference to the project bundle
 */
async function addLibFiles(project: ProjectBundle) {
	if (project.tsconfig.compilerOptions && project.tsconfig.compilerOptions.lib) {
		const tasks = project.tsconfig.compilerOptions.lib
			.map(async (lib) => {
				const filename = `lib.${lib}.d.ts`;
				project.environmentFiles.push(createProjectFile(
					filename,
					await getFile(join('node_modules', 'typescript', 'lib', filename)),
					ProjectFileType.Lib
				));
				log('  ' + bold.blue('adding') + ` lib "${lib}"`, true);
			});
		return Promise.all(tasks);
	}
	return Promise.all([]);
}

/**
 * Determine the project file type for a given file name
 * @param name The file to get the project file type for
 */
function getProjectFileType(name: string): ProjectFileType {
	const ext = extname(name);
	switch (ext) {
	case '.ts':
		return /\.d\.ts$/.test(name) ? ProjectFileType.Definition : ProjectFileType.TypeScript;
	case '.html':
		return ProjectFileType.HTML;
	case '.css':
		return ProjectFileType.CSS;
	case '.json':
		return ProjectFileType.JSON;
	case '.xml':
		return ProjectFileType.XML;
	case '.md':
		return ProjectFileType.Markdown;
	default:
		return ProjectFileType.PlainText;
	}
}

/**
 * An asnyc function which loads any of the `include` files that are specified in the `tsconfig.json` plus
 * other related static content files.
 * @param project The reference to the project bundle
 * @param includeExtension A comma deliminated string of extensions to be included in the project files
 */
async function addProjectFiles(project: ProjectBundle, includeExtensions: string = 'ts,html,css,json,xml,md') {
	if (project.tsconfig.include) {
		const globs = await Promise.all(project.tsconfig.include
			.map((pattern) => getGlob(pattern.replace(/(\.d)?\.ts$/, `.{${includeExtensions}}`))));
		const files = globs.reduce((previous, current) => previous.concat(current), <string[]> []);
		const tasks = files.map(async (name) => {
			const text = await getFile(name);
			log('  ' + bold.blue('adding') + ` project file "${name}"`, true);
			project.files.push({
				name,
				text,
				type: getProjectFileType(name)
			});
		});
		return Promise.all(tasks);
	}
	return Promise.all([]);
};

/**
 * An async function which loads any of the `compilerOptions.types` that are specified in the `tsconfig.json`
 * @param project The reference to the project bundle
 */
async function addTypesFiles(project: ProjectBundle) {
	if (project.tsconfig.compilerOptions && project.tsconfig.compilerOptions.types) {
		const tasks = project.tsconfig.compilerOptions.types.map(async (packageName) => {
			log('  ' + bold.blue('resolving') + ` types for package "${packageName}"`, true);
			const packageJson: PackageJson = require(join(packageName, 'package.json'));
			const packageJsonFilename = relative(cwd(), resolve(join(packageName, 'package.json')));
			project.environmentFiles.push(createProjectFile(packageJsonFilename, JSON.stringify(packageJson), ProjectFileType.JSON));
			if (packageJson.typings || packageJson.types) {
				const filename = relative(cwd(), resolve(normalize(join(packageName, (packageJson.typings || packageJson.types)!))));
				project.environmentFiles.push(createProjectFile(filename, await getFile(filename)));
				log('  ' + bold.blue('adding') + ` type file "${filename}"`, true);
			}
			else {
				log('  ' + bold.yellow('warn') + ` "${packageJsonFilename}" does not contain type information`);
				try { /* try to find an index.d.ts file, since none specified in package.json */
					const filename = relative(cwd(), resolve(normalize(join(packageName, 'index.d.ts'))));
					project.environmentFiles.push(createProjectFile(filename, await getFile(filename)));
					log('  ' + bold.blue('adding') + ` type file "${filename}"`, true);
				}
				catch (e) { /* swallow error */ }
			}
		});
		return Promise.all(tasks);
	}
	return Promise.all([]);
}

/**
 * An async function which will glob any definitions that are included in `node_modules/@dojo` or `node_modules/@types`
 * @param project The reference to the project bundle
 */
async function addDefinitionFiles(project: ProjectBundle) {
	const files = await getGlob('node_modules/{@dojo,@types}/**/*.d.ts');
	const tasks = files
		.map(async (filename) => {
			if (DOJO_EXCLUDE.test(filename)) {
				return;
			}
			project.environmentFiles.push(createProjectFile(filename, await getFile(filename)));
			log('  ' + bold.blue('adding') + ` definition file "${filename}"`, true);
		});
	return Promise.all(tasks);
}

/**
 * An async function which resolves when a project bundle has been output for the specified path
 */
export default async function emitProject({ content, out, project: root, verbose }: EmitArgs) {
	verboseFlag = verbose;

	log(underline('\nEmit editor project bundle'));

	try {
		const initialwd = cwd();
		chdir(root);
		if (cwd() !== initialwd) {
			log('  ' + bold.blue('changing') + ` working directory to "${root}"`, true);
		}
		const project = await createProject();

		const tasks: Promise<any>[] = [];
		tasks.push(addLibFiles(project));
		tasks.push(addTypesFiles(project));
		tasks.push(addDefinitionFiles(project));
		if (content) {
			log('  ' + bold.blue('setting') + ` project file extensions to "${content}"`, true);
		}
		tasks.push(addProjectFiles(project, content));
		await Promise.all(tasks);

		/* write out project bundle file */
		const outfilename = `${(project.package.name || 'bundle').replace(/[\/\\]/, '-')}.project.json`;
		const outfile = relative(cwd(), normalize(join(initialwd, out, outfilename)));
		await setFile(outfile, JSON.stringify(project));
		log('  ' + bold.green('emitted') + ` to "${relative(initialwd, outfile)}"\n`);
	}
	catch (e) {
		const stack: string[] = e.stack.split('\n');
		log('  ' + bold.red('errored') + ' ' + stack.shift());
		log(stack.join('\n') + '\n');
	}
}
