// Dependencies
const fs = require('fs');
const path = require('path');
const exitHook = require('async-exit-hook'); // Controlled process exits, to gracefully clean up and store/restore state



const defaults = {
	// Catch uncaught exceptions and then shutdown.
	// See: https://nodejs.org/api/process.html#process_warning_using_uncaughtexception_correctly
	catchExceptions: true,
	
	// Save session state automatically every 5 minutes in milliseconds
	autosave: 5 * 60 * 1000,
	
	// Path to file to store state in
	path: 'session.json'
};


class GracefulRecovery {
	constructor(configuration = {}) {
		let options = Object.assign({}, defaults, configuration);
		
		// Bind methods
		this.willShutdown = this.willShutdown.bind(this);
		this.onAutosave = this.onAutosave.bind(this);
		
		// Store path to location where to save state at
		this.path = options.path;
		
		// Handle uncaught exceptions and rejections
		if(options.catchExceptions !== false)
		{
			exitHook.uncaughtExceptionHandler(err => console.error(err));
		}
		
		// Immediately dump state to disk when given opportunity to shutdown gracefully
		exitHook(this.willShutdown);
		
		// Autosave state in case of an abrupt shutdown
		if(options.autosave && typeof options.autosave === 'number')
		{
			this.autosaveInterval = setInterval(this.onAutosave, options.autosave);
		}
		
		this.snapshotHandlers = [];
	}
	
	willShutdown(callback) {
		this.dump(callback, 'shutdown');
	}
	
	onAutosave() {
		this.dump(null, 'autosave');
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
	async dump(callback, reason) {
		// Avoid overwriting any existing session data if we crashed before a snapshot handler could be registered
		if(!this.snapshotHandlers.length) return false;
		
		let structure = {
			meta: {
				at: +new Date,
				reason
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
			this.path,
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
			}
		);
		
		return defer.promise;
	}
	
	// Restore state from last session
	recovery(callback) {
		return new Promise(resolve => {
			let session;
			try { session = require(path.resolve(this.path)); } catch(e) { session = undefined }
			
			callback && callback(session);
			resolve(session);
		});
	}
}


module.exports = (options) => new GracefulRecovery(options);
