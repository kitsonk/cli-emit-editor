import { JsonSchemaForNpmPackageJsonFiles as PackageJson } from './package.json';
import { JsonSchemaForTheTypeScriptCompilersConfigurationFile as TsconfigJson } from './tsconfig.json';
import { JsonSchemaForTheTsLintConfigurationFiles as TslintJson } from './tslint.json';

export interface ProjectBundle {
	/**
	 * Files that are part of the environment but are not exposed for editing
	 *
	 * Typically these are TypeScript definition files and libraries that are needed
	 * to provide context to edit and compile the project files
	 */
	environmentFiles: ProjectFile[];

	/**
	 * These are the editable project files
	 */
	files: ProjectFile[];

	/**
	 * The package.json for the project
	 */
	package: PackageJson;

	/**
	 * The tsconfig.json for the project
	 */
	tsconfig: TsconfigJson;

	/**
	 * The tslint.json for the project
	 */
	tslint?: TslintJson;
}

export interface ProjectFile {
	type: ProjectFileType;
	name: string;
	text: string;
}

export const enum ProjectFileType {
	TypeScript = 1,
	Definition,
	Lib,
	JavaScript,
	CSS,
	HTML,
	Markdown,
	JSON,
	XML,
	PlainText
}
