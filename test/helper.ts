///<reference path="_ref.d.ts" />
///<reference path="globals.ts" />
///<reference path="assert/xm/_all.ts" />
///<reference path="assert/xm/unordered.ts" />
///<reference path="../src/xm/data/PackageJSON.ts" />

var global = this;

module helper {
	'use strict';

	var fs = require('fs');
	var path = require('path');
	var util = require('util');
	var Q:typeof Q = require('q');
	var FS:typeof QioFS = require('q-io/fs');
	var Reader:Qio.BufferReader = require('q-io/reader');
	var assert:Chai.Assert = require('chai').assert;
	var childProcess = require('child_process');
	var bufferEqual = require('buffer-equal');

	var shaRegExp = /^[0-9a-f]{40}$/;
	var md5RegExp = /^[0-9a-f]{32}$/;

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	export function getProjectRoot():string {
		return path.dirname(xm.PackageJSON.find());
	}

	export function getDirNameFixtures():string {
		return path.resolve(__dirname, '..', 'fixtures');
	}

	export function getDirNameTmp():string {
		return path.resolve(__dirname, '..', 'tmp');
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	//helper to get a readable debug message (useful when comparing things absed on 2 paths)
	//can be improved freely (as required as it is for visualisation only)
	export function getPathMessage(pathA:string, pathB:string, message:string):string {
		//make absolute
		pathA = path.resolve(pathA);
		pathB = path.resolve(pathB);
		var elemsA = pathA.split(path.sep);
		var elemsB = pathB.split(path.sep);

		//remove identical parts
		while (elemsA.length > 0 && elemsB.length > 0 && elemsA[0] === elemsB[0]) {
			elemsA.shift();
			elemsB.shift();
		}

		//same paths?
		if (elemsA.length === 0 && elemsA.length === elemsB.length) {
			return message + ': \'' + path.basename(pathA) + '\'';
		}

		//different, print remains
		return message + ': ' + '\'' + elemsA.join(path.sep) + '\' vs \'' + elemsB.join(path.sep) + '\'';
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	export function dump(object:any, message?:string, depth:number = 6, showHidden:boolean = false):any {
		message = xm.isUndefined(message) ? '' : message + ': ';
		xm.log(message + util.inspect(object, showHidden, depth, true));
	}

	export function dumpJSON(object:any, message?:string):any {
		message = xm.isUndefined(message) ? '' : message + ': ';
		xm.log(message + JSON.stringify(object, null, 4));
	}

	export function assertFormatSHA1(value:string, msg?:string) {
		assert.isString(value, msg);
		assert.match(value, shaRegExp, msg);
	}

	export function assertFormatMD5(value:string, msg?:string) {
		assert.isString(value, msg);
		assert.match(value, md5RegExp, msg);
	}

	export function propStrictEqual(actual, expected, prop:string, message:string) {
		assert.property(actual, prop, message + '.' + prop + ' actual');
		assert.property(expected, prop, message + '.' + prop + ' expected');
		assert.strictEqual(actual[prop], expected[prop], message + '.' + prop + ' equal');
	}

	export function assertBufferEqual(act:NodeBuffer, exp:NodeBuffer, msg?:string) {
		assert.instanceOf(act, Buffer, msg + ': ' + act);
		assert.instanceOf(exp, Buffer, msg + ': ' + exp);
		assert(bufferEqual(act, exp), msg + ': bufferEqual');
	}

	export function assertBufferUTFEqual(act:NodeBuffer, exp:NodeBuffer, msg?:string) {
		assert.instanceOf(act, Buffer, msg + ': ' + act);
		assert.instanceOf(exp, Buffer, msg + ': ' + exp);
		assert.strictEqual(act.toString('utf8'), exp.toString('utf8'), msg + ': bufferEqual');
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	//for safety
	function promiseDoneMistake() {
		throw new Error('don\'t use a done() callback when using it.eventually()');
	}

	//monkey patch
	it.eventually = function eventually(expectation:string, assertion?:(call:() => void) => void):void {
		it(expectation, (done) => {
			Q(assertion(promiseDoneMistake)).done(() => {
				done();
			}, (err) => {
				done(err);
			});
		});
	};

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	export interface AssertCB {
		(actual, expected, message:string):void;
	}
	export interface IsLikeCB {
		(actual, expected):boolean;
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	export interface RunCLIResult {
		code:number;
		error:Error;
		stdout:NodeBuffer;
		stderr:NodeBuffer;
		args:string[];
	}

	//TODO decide runCLI use fork(), exec() or spawn() (fork slightly faster? does it matter?)
	//TODO fix code to properly show errors
	export function runCLI(modulePath:string, args:string[], debug:boolean = false, cwd:string = './'):Q.Promise<RunCLIResult> {
		assert.isArray(args, 'args');

		var d:Q.Deferred<RunCLIResult> = Q.defer();

		var stdout:NodeBuffer[] = [];
		var stderr:NodeBuffer[] = [];

		var options:any = {
			cwd: path.resolve(cwd),
			silent: true
		};

		var getRes = (code:number = 0, err:Error = null):RunCLIResult => {
			var res:RunCLIResult = {
				code: code,
				error: err || null,
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr),
				args: args
			};
			if (debug && res.code > 0) {
				xm.log.debug(['node', modulePath , res.args.join(' ')].join(' '));
				xm.log.debug('error: ' + res.error);
				xm.log.debug('code: ' + res.code);
				/*xm.log(res.stdout.toString('utf8'));
				 if (res.stderr.length) {
				 xm.log.error(res.stderr.toString('utf8'));
				 }*/
			}
			return res;
		};

		args.unshift(modulePath);

		var child = childProcess.spawn('node', args, options);
		if (!child) {
			d.resolve(getRes(1, new Error('child spawned as null')));
			return d.promise;
		}

		child.stdout.on('data', (chunk) => {
			stdout.push(chunk);
			if (debug) {
				process.stdout.write(chunk);
			}
		});
		child.stderr.on('data', (chunk) => {
			stderr.push(chunk);
			if (debug) {
				process.stdout.write(chunk);
			}
		});

		child.on('error', (err) => {
			if (err) {
				xm.log.error('child process exited with code ' + err.code);
				xm.log.error(err);
			}
			//never fail (we might test for cli failure after all)
			d.resolve(getRes(1, err));
		});

		child.on('exit', (event) => {
			d.resolve(getRes(0, null));
		});

		return d.promise;
	}
}
