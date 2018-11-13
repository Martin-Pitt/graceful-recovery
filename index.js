// Dependencies
const fs = require('fs');
const path = require('path');
const exitHook = require('async-exit-hook'); // Controlled process exits, to gracefully clean up and store/restore state



const defaults = {
	// Catch any uncaught exceptions to trigger a dump with
	// See: https://nodejs.org/api/process.html#process_warning_using_uncaughtexception_correctly
	catchExceptions: true,
	
	// And with the above, if we do have an uncaught exception, whether to exit the process once we have dumped session to disk
	exitExceptions: true,
	
	// Save session state automatically every 5 minutes in milliseconds
	autosave: 5 * 60 * 1000,
	
	// Path to file to store state in
	path: 'session.json'
};


class GracefulRecovery {
	constructor(options = {}) {
		let config = this.config = {};
		Object.assign(config, defaults, options);
		
		// Bind methods
		this.willShutdown = this.willShutdown.bind(this);
		this.onAutosave = this.onAutosave.bind(this);
		this.onUncaughtException = this.onUncaughtException.bind(this);
		
		// Handle uncaught exceptions and rejections
		if(config.catchExceptions)
		{
			exitHook.uncaughtExceptionHandler(this.onUncaughtException);
		}
		
		// Immediately dump state to disk when given opportunity to shutdown gracefully
		exitHook(this.willShutdown);
		
		// Autosave state in case of an abrupt shutdown
		if(config.autosave && typeof config.autosave === 'number')
		{
			this.autosaveInterval = setInterval(this.onAutosave, config.autosave);
		}
		
		this.snapshotHandlers = [];
	}
	
	willShutdown(callback) {
		if(this.hasDumpedForShutdownAlready || this.isDumping) return;
		
		this.hasDumpedForShutdownAlready = true;
		
		this.dump(callback, 'shutdown');
	}
	
	onAutosave() {
		this.dump(null, 'autosave');
	}
	
	async onUncaughtException(err) {
		console.error(err);
		
		if(!this.isDumping)
		{
			this.hasDumpedForShutdownAlready = true;
			await this.dump(null, 'uncaught-exception', err);
		}
		
		if(this.config.exitExceptions) process.exit(1);
		else process.exitCode = 1;
	}
	
	registerSnapshot(callback) {
		this.snapshotHandlers.push(callback);
	}
	
	async snapshot(reason) {
		let count = this.snapshotHandlers.length;
		if(!count) return undefined;
		if(count === 1) return await this.snapshotHandlers[0](reason);
		
		let values = [];
		for(var iterator = 0; iterator < this.snapshotHandlers.length; ++iterator)
		{
			let handler = this.snapshotHandlers[iterator];
			let value = await handler(reason);
			values.push(value);
		}
		
		return values;
	}
	
	// We must save a snapshot of our session to the filesystem, just enough so that we can recover quickly
	async dump(callback, reason, error) {
		// Avoid overwriting any existing session data if we crashed before a snapshot handler could be registered
		if(!this.snapshotHandlers.length) return false;
		
		// Already dumping?
		if(this.isDumping);
		this.isDumping = true;
		
		
		let structure = {
			meta: {
				at: +new Date,
				reason,
				error: this.parseError(error)
			},
			state: await this.snapshot(reason)
		};
		let json = JSON.stringify(structure, null, '\t');
		
		let defer = {
			resolve: null,
			reject: null,
			promise: null
		};
		
		defer.promise = new Promise((resolve, reject) => {
			defer.resolve = resolve;
			defer.reject = reject;
		});
		
		fs.writeFile(
			this.config.path,
			json,
			'utf8',
			(err) => {
				if(err)
				{
					console.error('Was unable to store state', err);
					defer.reject && defer.reject(err);
				}
				
				defer.resolve && defer.resolve();
				callback && callback();
				
				this.isDumping = false;
			}
		);
		
		return defer.promise;
	}
	
	// Restore state from last session
	recovery(callback) {
		return new Promise(resolve => {
			let session;
			try { session = require(path.resolve(this.config.path)); } catch(e) { session = undefined }
			
			callback && callback(session);
			resolve(session);
		});
	}
	
	parseError(error) {
		if(!error)
		{
			return undefined;
		}
		
		// Does it support a proper JSON interface?
		else if(error.toJSON)
		{
			return error.toJSON();
		}
		
		// As per: https://stackoverflow.com/a/18391400/938335
		// We need to manually loop through the properties of an Error as they are not enumerable
		else if(error instanceof Error)
		{
			return Object.getOwnPropertyNames(error)
			.reduce((copy, key) => {
				copy[key] = error[key];
				return copy;
			}, {});
		}
		
		// Else return it plain, as it may be a custom error
		else
		{
			return error;
		}
	}
}


module.exports = (options) => new GracefulRecovery(options);
