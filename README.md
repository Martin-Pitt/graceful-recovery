# Graceful Recovery

The `graceful-recovery` module is designed with Node.js servers in mind that need to persist for long periods of time in production.

This is an abstraction library around [`async-exit-hook`](https://www.npmjs.com/package/async-exit-hook) that provides mechanisms for storing and recovering application state.

The state is wrapped in a JSON session object, see [Session JSON Structure](#session-json-structure).

You can design your own constraints as to whether to use the recovered data. If the data is particularly out of data or if part of it is still useful. For example I've used it in a meeting room system to recover the known room configurations, and also use Outlook calendar data if it is recent enough.


## Install

You can install it from npm:

```
npm install graceful-recovery
```



## How to use

```
// First we need to require it
const GracefulRecovery = require('graceful-recovery');


// Construct an instance with optional options
const graceful = GracefulRecovery({
	autosave: 10 * 60 * 1000 // Change autosave to 10m
});


// Then we need to call two methods:

// First, `graceful-recovery` needs a mechanism to be able to capture a snapshot of your application's state at any point:
graceful.registerSnapshot((reason) => {
	// Called by autosave or during process shutdown using async-exit-hook
	// Return a value we want to save as a snapshot
	return { foo: 'bar.' + Math.random() };
});

// Secondly, we can initiate recovery of a previous session:
graceful.recovery(session => {
	// If no previous session exists (or was unable to parse it) then session will be undefined
	Application.init(session);
});
```

* If multiple snapshot handlers are registered then the state property will be an array of values returned from each handler
* Snapshot handlers can be asynchronous, which will try to delay a shutdown


## API

### Constructor

The `GracefulRecovery` class can be instantiated with an optional `options` object:

* `options.path`: `String` – Path to store the session JSON in. By default this is set to `session.json` which stores it in that file on the current directory.
* `options.autosave`: `Number` – Time in milliseconds to automatically take a snapshot and dump to disk. By default this is every 5 minutes (`5 * 60 * 1000`).
* `options.catchExceptions`: `Boolean` – Whether to catch any uncaught exceptions that would have shutdown the process. Enabled by default. See: https://nodejs.org/api/process.html#process_warning_using_uncaughtexception_correctly – NOTE: Application state may be in an undefined state at this point, use this if you can be sure you can take a snapshot that you could recover from. You can use the snapshot handler's `reason` parameter of `uncaught-exception` to make a decision on critical or safe data you want to store.
* `options.exitExceptions`: `Boolean` – per the above, whether to actually exit the process ourselves once we have dumped a session to disk. Enabled by default.


### registerSnapshot

Allows you to register a snapshot handler which will return a value (object, number, string, etc) to store as the session state.

```
graceful.registerSnapshot(function() {
	return 'Hello, World!';
});
```

Registering multiple handlers will store each snapshots' value in an array.

You can also return a promise that resolves to a value for asynchronous usage.
Which means you can use async/await with it:

```
graceful.registerSnapshot(async (reason) => {
	if(reason !== 'autosave') await Application.cleanup();
	return Application.state;
});
```

`registerSnapshot` passes a `reason` string as a parameter. Which is the reason the snapshot was taken.

```
graceful.registerSnapshot(async (reason) => {
	if(reason === 'shutdown') return Application.quickSyncSnapshot(); // We have only a few seconds, shutdown quick
	else if(reason === 'autosave') return Application.bigSlowSnapshot(); // Autosave is done on our own terms – helps for a consistent performance
	else if(reason === 'uncaught-exception') return null; // We can't recover after an undefined application state as it can't be trusted
});
```

* `shutdown` – per [`async-exit-hook`](https://www.npmjs.com/package/async-exit-hook) this combines multiple shutdown signals to catch all the ways a process can exit
* `autosave` – the `graceful-recovery` module initiated an autosave (see `options.autosave`)
* `uncaught-exception` – the `graceful-recovery` module caught an exception that was not handled, giving you can option to store a snapshot before shutting down (unless you prevented it yourself)


### recovery

```
graceful.recovery(function RecoveryCallback(session) {
	Application.initialise(session);
});
```

The `recovery` method initiates a session recovery from the last `session` available on disk (see `options.path`), otherwise it returns `undefined`. See Session JSON Structure for more information on `session`.

`recovery` also returns a Promise – if you wish to use it that way, e.g.

```
graceful.recovery().then(session => {});
```


## Session JSON Structure

The `session` object stored on disk and as returned by the recovery callback takes the form of:

```
{
	"meta": {
		"at": Number, // Timestamp in milliseconds
		"reason": "shutdown" || "autosave" || "uncaught-exception"
		"error"?: {
			"stack": "Error: oops at somewhere.js",
			"message": "oops"
		}
	},
	"state": ‹value› || [‹value›, …] // Any value returned by snapshot or array of values for multiple snapshot handlers
}
```

If the reason was an uncaught-exception the error will be passed along to the `meta.error`.
Which you could report the next restart if you wanted to.


For example if a `{ foo: 'bar.‹random number›' }` snapshot was given to the module during a shutdown:

```
{
	"meta": {
		"at": 1542039520366,
		"reason": "shutdown"
	},
	"state": {
		"foo": "bar.0.17128608786886335"
	}
}
```

Or due to an uncaught exception:
```
{
	"meta": {
		"at": 1542117121167,
		"reason": "uncaught-exception",
		"error": {
			"stack": "Error: oops\n    at Timeout.setTimeout [as _onTimeout] (/path/to/script.js:10:8)\n    at listOnTimeout (timers.js:324:15)\n    at processTimers (timers.js:268:5)",
			"message": "oops"
		}
	},
	"state": {
		"foo": "bar.0.13781564326899165"
	}
}
```


* `meta` contains `graceful-recovery`-specific data
* `meta.at` is the timestamp in milliseconds when the session was saved at
* `meta.reason` is the reason that the session was saved, e.g. due to a "shutdown" signal or due to the "autosave" mechanism
* `state` is the returned value of the `registerSnapshot` handler – unless you registered multiple snapshot handlers then this will be an array of all the values
