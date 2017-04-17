import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import * as mockery from 'mockery';
import { stub, spy, SinonStub, SinonSpy } from 'sinon';

import * as fs from 'fs';
import * as process from 'process';

import { EmitArgs } from '../../src/main';
import { ProjectFileType } from '../../src/interfaces/editor';

let emitProject: (args: EmitArgs) => Promise<void>;
let accessStub: SinonStub;
let readFileStub: SinonStub;
let writeFileStub: SinonStub;
let chdirStub: SinonStub;
let cwdStub: SinonStub;
let consoleLogStub: SinonStub;
let globStub: SinonSpy;
let resolveStub: SinonStub;
let emitArgs: any;
let accessMap: { [filename: string]: boolean };
let readFileMap: { [filename: string]: string };
let globMap: { [pattern: string]: string[] };
let resolveMap: { [mid: string]: string };
let consolelogStack: any[];

registerSuite({
	name: 'emitProject',

	setup() {
		mockery.enable({
			warnOnUnregistered: false,
			warnOnReplace: false
		});

		accessStub = stub(fs, 'access', (name: string, constants: any, callback: (err?: any) => void) => {
			if (name in accessMap && !accessMap[name]) {
				callback(new Error('file not found!'));
			}
			else {
				accessMap[name] = true;
				callback();
			}
		});

		readFileStub = stub(fs, 'readFile', (name: string, encoding: string, callback: (err?: any, data?: string) => void) => {
			const result = readFileMap[name] = readFileMap[name] || '';
			if (result !== 'err') {
				callback(undefined, result);
			}
			else {
				callback(new Error('file not found'));
			}
		});

		writeFileStub = stub(fs, 'writeFile', (filename: string, contents: string, options: any, callback: (err?: any) => void) => {
			if (filename === 'err.project.json') {
				callback(new Error('error writing file'));
			}
			else {
				callback();
			}
		});

		chdirStub = stub(process, 'chdir', (path: string) => {
			if (path === '../other-project') {
				cwdStub.returns('/var/projects/other-project');
			}
		});
		cwdStub = stub(process, 'cwd').returns('/var/projects/test-project');
		globStub = spy((pattern: string, callback: (err?: any, matches?: string[]) => void) => {
			const result = globMap[pattern] = globMap[pattern] || [];
			if (result[0] === 'err') {
				callback(new Error('glob error'));
			}
			else {
				callback(undefined, result);
			}
		});

		mockery.registerMock('glob', globStub);
		mockery.registerMock('foo/package.json', {
			types: 'foo.d.ts'
		});
		mockery.registerMock('bar/package.json', {
			typings: 'bar.d.ts'
		});
		mockery.registerMock('baz/package.json', {});

		const emitProjectModule = require('intern/dojo/node!./../../src/emitProject');

		resolveStub = stub(emitProjectModule, 'requireResolve', (mid: string) => {
			return resolveMap[mid] = resolveMap[mid] || '/var/projects/test-project/node_modules/' + mid;
		});

		emitProject = emitProjectModule.default;
	},

	teardown() {
		mockery.deregisterAll();
		mockery.disable();

		accessStub.restore();
		readFileStub.restore();
		writeFileStub.restore();
		chdirStub.restore();
		cwdStub.restore();
		resolveStub.restore();
	},

	beforeEach() {
		consoleLogStub = stub(console, 'log', (...args: any[]) => {
			consolelogStack.push(args);
		});

		consolelogStack = [];

		emitArgs = {
			content: undefined,
			out: '.',
			project: '.',
			verbose: false
		};

		accessMap = {};
		readFileMap = {
			'package.json': JSON.stringify({ name: 'test-package' }),
			'tsconfig.json': JSON.stringify({ compilerOptions: { }, include: [ 'src/**/*.ts' ] }),
			'node_modules/@dojo/loader/dojo-loader-2.0.0.d.ts': 'loader',
			'node_modules/@dojo/core/lang.d.ts': 'lang',
			'node_modules/@types/chai/assert.d.ts': 'assert'
		};
		globMap = {
			'src/**/*.{ts,html,css,json,xml,md}': [ './src/index.html' ]
		};
		resolveMap = {};
	},

	afterEach() {
		consoleLogStub.restore();

		accessStub.reset();
		readFileStub.reset();
		writeFileStub.reset();
		chdirStub.reset();
		cwdStub.reset();
		cwdStub.returns('/var/projects/test-project');
		globStub.reset();
		resolveStub.reset();
	},

	async 'emits a project bundle with default arguments'() {
		await emitProject(emitArgs);
		assert.strictEqual(consoleLogStub.callCount, 2);
		assert.strictEqual(writeFileStub.callCount, 1, 'project should have been written');
		assert.strictEqual(writeFileStub.lastCall.args[0], 'test-package.project.json', 'should have written expected filename');
		assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
			dependencies: { development: {}, production: {} },
			environmentFiles: [],
			files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
			index: './src/index.html',
			package: { name: 'test-package' },
			tsconfig: { compilerOptions: { }, include: [ 'src/**/*.ts' ] }
		}, 'should have written expected contents');
		assert.isTrue(accessMap['package.json'], 'should have checked to see if package.json exists');
		assert.isTrue(accessMap['tsconfig.json'], 'should have checked to see if package.json exists');
	},

	async 'adds appropriate lib files to project'() {
		readFileMap['tsconfig.json'] = JSON.stringify({
			compilerOptions: {
				lib: [ 'foo', 'bar' ]
			},
			include: [ 'src/**/*.ts' ]
		});
		readFileMap['node_modules/typescript/lib/lib.foo.d.ts'] = 'foo';
		readFileMap['node_modules/typescript/lib/lib.bar.d.ts'] = 'bar';
		await emitProject(emitArgs);
		assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
			dependencies: { development: {}, production: {} },
			environmentFiles: [
				{ name: 'lib.foo.d.ts', text: 'foo', type: ProjectFileType.Lib },
				{ name: 'lib.bar.d.ts', text: 'bar', type: ProjectFileType.Lib }
			],
			files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
			index: './src/index.html',
			package: { name: 'test-package' },
			tsconfig: {
				compilerOptions: {
					lib: [ 'foo', 'bar' ]
				},
				include: [ 'src/**/*.ts' ]
			}
		}, 'should have written expected contents');
	},

	async 'resolves types specified in the tsconfig.json'() {
		readFileMap['tsconfig.json'] = JSON.stringify({
			compilerOptions: {
				types: [ 'foo', 'bar', 'baz' ]
			},
			include: [ 'src/**/*.ts' ]
		});
		await emitProject(emitArgs);
		assert.strictEqual(consoleLogStub.callCount, 3, 'should have logged a warning');
		assert.include(consoleLogStub.getCall(1).args[0], '"node_modules/baz/package.json" does not contain type information', 'warning should include proper info');
		assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
			dependencies: { development: {}, production: {} },
			environmentFiles: [
				{ name: 'node_modules/foo/package.json', text: '{"types":"foo.d.ts"}', type: ProjectFileType.JSON },
				{ name: 'node_modules/bar/package.json', text: '{"typings":"bar.d.ts"}', type: ProjectFileType.JSON },
				{ name: 'node_modules/baz/package.json', text: '{}', type: ProjectFileType.JSON },
				{ name: 'node_modules/foo/foo.d.ts', text: '', type: ProjectFileType.Definition },
				{ name: 'node_modules/bar/bar.d.ts', text: '', type: ProjectFileType.Definition },
				{ name: 'node_modules/baz/index.d.ts', text: '', type: ProjectFileType.Definition }
			],
			files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
			index: './src/index.html',
			package: { name: 'test-package' },
			tsconfig: {
				compilerOptions: {
					types: [ 'foo', 'bar', 'baz' ]
				},
				include: [ 'src/**/*.ts' ]
			}
		}, 'should have written expected contents');
	},

	async 'automatically adds @dojo and @types definitions'() {
		globMap['node_modules/{@dojo,@types}/**/*.d.ts'] = [
			'node_modules/@dojo/loader/interfaces.d.ts',
			'node_modules/@dojo/loader/dojo-loader-2.0.0.d.ts',
			'node_modules/@dojo/core/lang.d.ts',
			'node_modules/@types/chai/assert.d.ts'
		];
		await emitProject(emitArgs);
		assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
		assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
			dependencies: { development: {}, production: {} },
			environmentFiles: [
				{ name: 'node_modules/@dojo/loader/dojo-loader-2.0.0.d.ts', text: 'loader', type: ProjectFileType.Definition },
				{ name: 'node_modules/@dojo/core/lang.d.ts', text: 'lang', type: ProjectFileType.Definition },
				{ name: 'node_modules/@types/chai/assert.d.ts', text: 'assert', type: ProjectFileType.Definition }
			],
			files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
			index: './src/index.html',
			package: { name: 'test-package' },
			tsconfig: { compilerOptions: {}, include: [ 'src/**/*.ts' ] }
		}, 'should have written expected contents');
	},

	async 'adds project files based on tsconfig.json'() {
		globMap['src/**/*.{ts,html,css,json,xml,md}'] = [
			'src/index.ts',
			'./src/index.html',
			'src/core.css',
			'src/config/config.json',
			'src/config/build.xml',
			'src/README.md',
			'src/interfaces.d.ts',
			'src/text.txt'
		];
		readFileMap['tsconfig.json'] = JSON.stringify({
			compilerOptions: { },
			include: [ 'src/**/*.ts' ]
		});
		await emitProject(emitArgs);
		assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
		assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
			dependencies: { development: {}, production: {} },
			environmentFiles: [],
			files: [
				{ name: 'src/index.ts', text: '', type: ProjectFileType.TypeScript },
				{ name: './src/index.html', text: '', type: ProjectFileType.HTML },
				{ name: 'src/core.css', text: '', type: ProjectFileType.CSS },
				{ name: 'src/config/config.json', text: '', type: ProjectFileType.JSON },
				{ name: 'src/config/build.xml', text: '', type: ProjectFileType.XML },
				{ name: 'src/README.md', text: '', type: ProjectFileType.Markdown },
				{ name: 'src/interfaces.d.ts', text: '', type: ProjectFileType.Definition },
				{ name: 'src/text.txt', text: '', type: ProjectFileType.PlainText }
			],
			index: './src/index.html',
			package: { name: 'test-package' },
			tsconfig: {
				compilerOptions: {},
				include: [ 'src/**/*.ts' ]
			}
		}, 'should have written expected contents');
	},

	'resolves package dependencies': {
		async 'no additional dependencies'() {
			mockery.registerMock('dep1/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep2/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep3/package.json', {
				dependencies: {}
			});

			readFileMap['package.json'] = JSON.stringify({
				name: 'test-package',
				dependencies: {
					'dep1': '1.0.0'
				},
				peerDependencies: {
					'dep2': '2.0.0'
				},
				devDependencies: {
					'dep3': '0.1.0'
				}
			});

			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2);
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: { development: {
					'dep3': '0.1.0'
				}, production: {
					'dep1': '1.0.0',
					'dep2': '2.0.0'
				} },
				environmentFiles: [],
				files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
				index: './src/index.html',
				package: {
					name: 'test-package',
					dependencies: {
						'dep1': '1.0.0'
					},
					peerDependencies: {
						'dep2': '2.0.0'
					},
					devDependencies: {
						'dep3': '0.1.0'
					}
				},
				tsconfig: { compilerOptions: { }, include: [ 'src/**/*.ts' ] }
			}, 'should have written expected contents');
		},

		async 'should ignore dev dependencies on deeper packages'() {
			mockery.registerMock('dep1/package.json', {
				dependencies: {
					'dep4': 'next'
				},
				devDependencies: {
					'dep5': '2.0.0'
				}
			});
			mockery.registerMock('dep2/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep3/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep4/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep5/package.json', {
				dependencies: {}
			});
			readFileMap['package.json'] = JSON.stringify({
				name: 'test-package',
				dependencies: {
					'dep1': '1.0.0'
				},
				peerDependencies: {
					'dep2': '2.0.0'
				},
				devDependencies: {
					'dep3': '0.1.0'
				}
			});

			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2);
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: {
					development: {
						'dep3': '0.1.0'
					},
					production: {
						'dep1': '1.0.0',
						'dep2': '2.0.0',
						'dep4': 'next'
					}
				},
				environmentFiles: [],
				files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
				index: './src/index.html',
				package: {
					name: 'test-package',
					dependencies: {
						'dep1': '1.0.0'
					},
					peerDependencies: {
						'dep2': '2.0.0'
					},
					devDependencies: {
						'dep3': '0.1.0'
					}
				},
				tsconfig: { compilerOptions: { }, include: [ 'src/**/*.ts' ] }
			}, 'should have written expected contents');
		},

		async 'no package.json for dependency'() {
			mockery.registerMock('dep1/package.json', {
				dependencies: {
					'dep6': 'next'
				},
				devDependencies: {
					'dep5': '2.0.0'
				}
			});
			mockery.registerMock('dep2/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep3/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep4/package.json', {
				dependencies: {}
			});
			mockery.registerMock('dep5/package.json', {
				dependencies: {}
			});
			readFileMap['package.json'] = JSON.stringify({
				name: 'test-package',
				dependencies: {
					'dep1': '1.0.0'
				},
				peerDependencies: {
					'dep2': '2.0.0'
				},
				devDependencies: {
					'dep3': '0.1.0'
				}
			});

			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2);
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: {
					development: {
						'dep3': '0.1.0'
					},
					production: {
						'dep1': '1.0.0',
						'dep2': '2.0.0',
						'dep6': 'next'
					}
				},
				environmentFiles: [],
				files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
				index: './src/index.html',
				package: {
					name: 'test-package',
					dependencies: {
						'dep1': '1.0.0'
					},
					peerDependencies: {
						'dep2': '2.0.0'
					},
					devDependencies: {
						'dep3': '0.1.0'
					}
				},
				tsconfig: { compilerOptions: { }, include: [ 'src/**/*.ts' ] }
			}, 'should have written expected contents');
		},

		async 'dual dependencies, first one wins'() {
			mockery.registerMock('dep1/package.json', {
				dependencies: {
					'dep4': '1.0.0'
				}
			});
			mockery.registerMock('dep2/package.json', {
				dependencies: {
					'dep4': '1.0.1'
				}
			});
			mockery.registerMock('dep3/package.json', {
				dependencies: {
					'dep4': '2.0.0'
				}
			});
			mockery.registerMock('dep4/package.json', {
				dependencies: {}
			});
			readFileMap['package.json'] = JSON.stringify({
				name: 'test-package',
				dependencies: {
					'dep1': '1.0.0'
				},
				peerDependencies: {
					'dep2': '2.0.0'
				},
				devDependencies: {
					'dep3': '0.1.0'
				}
			});

			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2);
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: {
					development: {
						'dep3': '0.1.0',
						'dep4': '2.0.0'
					},
					production: {
						'dep1': '1.0.0',
						'dep2': '2.0.0',
						'dep4': '1.0.0'
					}
				},
				environmentFiles: [],
				files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
				index: './src/index.html',
				package: {
					name: 'test-package',
					dependencies: {
						'dep1': '1.0.0'
					},
					peerDependencies: {
						'dep2': '2.0.0'
					},
					devDependencies: {
						'dep3': '0.1.0'
					}
				},
				tsconfig: { compilerOptions: { }, include: [ 'src/**/*.ts' ] }
			}, 'should have written expected contents');
		},

		async 'deep dependencies with duplicates'() {
			mockery.registerMock('dep1/package.json', {
				dependencies: {
					'dep2': '1.0.0',
					'dep3': '2.0.0',
					'dep4': '1.0.0'
				}
			});
			mockery.registerMock('dep2/package.json', {
				dependencies: {
					'dep3': '1.0.0',
					'dep4': '1.0.0'
				}
			});
			mockery.registerMock('dep3/package.json', {
				dependencies: {
					'dep4': '2.0.0'
				}
			});
			mockery.registerMock('dep4/package.json', {
				dependencies: {}
			});
			readFileMap['package.json'] = JSON.stringify({
				name: 'test-package',
				dependencies: {
					'dep1': '1.0.0'
				}
			});

			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2);
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: {
					development: { },
					production: {
						'dep1': '1.0.0',
						'dep2': '1.0.0',
						'dep3': '1.0.0',
						'dep4': '2.0.0'
					}
				},
				environmentFiles: [],
				files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
				index: './src/index.html',
				package: {
					name: 'test-package',
					dependencies: {
						'dep1': '1.0.0'
					}
				},
				tsconfig: { compilerOptions: { }, include: [ 'src/**/*.ts' ] }
			}, 'should have written expected contents');
		},

		async 'sub peer dependencies'() {
			mockery.registerMock('dep1/package.json', {
				dependencies: {
					'dep2': '1.0.0',
					'dep4': '1.0.0'
				},
				peerDependencies: {
					'dep3': '2.0.0'
				}
			});
			mockery.registerMock('dep2/package.json', {
				dependencies: {
					'dep3': '1.0.0'
				},
				peerDependencies: {
					'dep4': '1.0.0'
				}
			});
			mockery.registerMock('dep3/package.json', {
				dependencies: {
					'dep4': '2.0.0'
				}
			});
			mockery.registerMock('dep4/package.json', {
				dependencies: {}
			});
			readFileMap['package.json'] = JSON.stringify({
				name: 'test-package',
				dependencies: {
					'dep1': '1.0.0'
				}
			});

			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2);
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: {
					development: { },
					production: {
						'dep1': '1.0.0',
						'dep2': '1.0.0',
						'dep3': '1.0.0',
						'dep4': '1.0.0'
					}
				},
				environmentFiles: [],
				files: [ { name: './src/index.html', text: '', type: ProjectFileType.HTML } ],
				index: './src/index.html',
				package: {
					name: 'test-package',
					dependencies: {
						'dep1': '1.0.0'
					}
				},
				tsconfig: { compilerOptions: { }, include: [ 'src/**/*.ts' ] }
			}, 'should have written expected contents');
		}
	},

	async 'package.json does not contain a name'() {
		readFileMap['package.json'] = '{}';
		await emitProject(emitArgs);
		assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
		assert.strictEqual(writeFileStub.lastCall.args[0], 'bundle.project.json', 'should have written expected filename');
	},

	async 'package name contains slashes'() {
		readFileMap['package.json'] = JSON.stringify({ name: '@dojo/widget-core' });
		await emitProject(emitArgs);
		assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
		assert.strictEqual(writeFileStub.lastCall.args[0], '@dojo-widget-core.project.json', 'should have written expected filename');
	},

	'emit arguments': {
		async 'index'() {
			globMap['src/**/*.{ts,html}'] = [
				'src/index.ts',
				'src/foo.html'
			];
			readFileMap['tsconfig.json'] = JSON.stringify({
				compilerOptions: { },
				include: [ 'src/**/*.ts' ]
			});
			emitArgs.content = 'ts,html';

			emitArgs.index = 'src/foo.html';
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: { development: {}, production: {} },
				environmentFiles: [],
				files: [
					{ name: 'src/index.ts', text: '', type: ProjectFileType.TypeScript },
					{ name: 'src/foo.html', text: '', type: ProjectFileType.HTML }
				],
				index: 'src/foo.html',
				package: { name: 'test-package' },
				tsconfig: {
					compilerOptions: {},
					include: [ 'src/**/*.ts' ]
				}
			}, 'should have written expected contents');
		},

		async 'out'() {
			emitArgs.out = 'dev';
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
			assert.strictEqual(writeFileStub.lastCall.args[0], 'dev/test-package.project.json', 'should have written to proper path');
		},

		async 'project'() {
			emitArgs.project = '../other-project';
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
			assert.strictEqual(process.cwd(), '/var/projects/other-project', 'current working directory was changed');
		},

		async 'content'() {
			globMap['src/**/*.{ts,html}'] = [
				'src/index.ts',
				'./src/index.html'
			];
			readFileMap['tsconfig.json'] = JSON.stringify({
				compilerOptions: { },
				include: [ 'src/**/*.ts' ]
			});
			emitArgs.content = 'ts,html';
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 2, 'should have only logged twice to console');
			assert.deepEqual(JSON.parse(writeFileStub.lastCall.args[1]), {
				dependencies: { development: {}, production: {} },
				environmentFiles: [],
				files: [
					{ name: 'src/index.ts', text: '', type: ProjectFileType.TypeScript },
					{ name: './src/index.html', text: '', type: ProjectFileType.HTML }
				],
				index: './src/index.html',
				package: { name: 'test-package' },
				tsconfig: {
					compilerOptions: {},
					include: [ 'src/**/*.ts' ]
				}
			}, 'should have written expected contents');
		},

		'verbose': {
			async 'standard args'() {
				emitArgs.verbose = true;
				await emitProject(emitArgs);
				assert.strictEqual(consoleLogStub.callCount, 5, 'should have logged propertly to console');
			}
		}
	},

	'error conditions': {
		async 'package.json missing'() {
			accessMap['package.json'] = false;
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 3, 'should have logged propertly to console');
			assert.include(consoleLogStub.getCall(1).args[0], 'Error: Path "/var/projects/test-project" does not contain a "tsconfig.json" and "package.json".');
		},

		async 'tsconfig.json missing'() {
			accessMap['tsconfig.json'] = false;
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 3, 'should have logged propertly to console');
			assert.include(consoleLogStub.getCall(1).args[0], 'Error: Path "/var/projects/test-project" does not contain a "tsconfig.json" and "package.json".');
		},

		async 'error reading a file'() {
			readFileMap['tsconfig.json'] = JSON.stringify({
				compilerOptions: {
					lib: [ 'foo' ]
				}
			});
			readFileMap['node_modules/typescript/lib/lib.foo.d.ts'] = 'err';
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 3, 'should have logged properly to the console');
			assert.include(consoleLogStub.getCall(1).args[0], 'Error: file not found');
		},

		async 'error writing a file'() {
			readFileMap['package.json'] = JSON.stringify({ name: 'err' });
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 3, 'should have logged properly to the console');
			assert.include(consoleLogStub.getCall(1).args[0], 'Error: error writing file');
		},

		async 'error with glob'() {
			globMap['src/**/*.{ts,html}'] = [ 'err' ];
			emitArgs.content = 'ts,html';
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 3, 'should have logged properly to the console');
			assert.include(consoleLogStub.getCall(1).args[0], 'Error: glob error');
		},

		async 'error not resolving project index'() {
			globMap['src/**/*.{ts,html}'] = [ 'src/index.ts' ];
			emitArgs.content = 'ts,html';
			await emitProject(emitArgs);
			assert.strictEqual(consoleLogStub.callCount, 3, 'should have logged properly to the console');
			assert.include(consoleLogStub.getCall(1).args[0], 'unable to find index "./src/index.html" in project.');
		}
	}
});
