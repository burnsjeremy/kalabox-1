/**
 * Module to wrap and abstract access to docker compose.
 * @module compose
 */

'use strict';

module.exports = function(kbox) {

  // Native modules
  var path = require('path');
  var url = require('url');

  // NPM modules
  var _ = require('lodash');
  var fs = require('fs-extra');
  var VError = require('verror');

  // Kalabox modules
  var bin = require('./lib/bin.js')(kbox);
  var env = require('./lib/env.js')(kbox);
  var machine = require('./machine.js')(kbox);
  var Promise = kbox.Promise;

  // Get some composer things
  var COMPOSE_EXECUTABLE = bin.getComposeExecutable();

  // Set of logging functions.
  var log = kbox.core.log.make('COMPOSE');

  /*
   * Run a provider command in a shell.
   */
  var shCompose = function(cmd, opts) {

    // Set the machine env
    env.setDockerEnv();

    // Get our config so we can set our env correctly
    return machine.engineConfig()

    // Set correct ENV for remote docker composing
    .then(function(config) {

      // Parse the docker host url
      var dockerHost = url.format({
        protocol: 'tcp',
        slashes: true,
        hostname: config.host,
        port: config.port
      });

      // Set our compose env
      kbox.core.env.setEnv('DOCKER_HOST', dockerHost);
      kbox.core.env.setEnv('DOCKER_TLS_VERIFY', 1);
      kbox.core.env.setEnv('DOCKER_MACHINE_NAME', config.machine);
      kbox.core.env.setEnv('DOCKER_CERT_PATH', config.certDir);

      // Run a provider command in a shell.
      return Promise.retry(function() {
        log.debug('Running command ' + cmd);
        return bin.sh([COMPOSE_EXECUTABLE].concat(cmd), opts);
      });
    });

  };

  /*
   * Figure out what to do with the compose data we have
   * and then return a files array
   */
  var parseComposeData = function(compose, project, opts) {

    // Start up a collector of files
    var files = [];

    // Check if we are in binary mode or not.
    var isBin = kbox.core.deps.get('globalConfig').isBinary;

    // Export our compose stuff and add to commands
    _.forEach(compose, function(unit) {

      // If we are in binary mode and have internal compose files then we
      // have to read in files and then export them out because
      // docker compose cannot read a file that is in a binary
      if (isBin && opts.internal) {
        if (typeof unit === 'string') {
          var newUnit = kbox.util.yaml.toJson(unit);
          unit = newUnit;
        }
      }

      // Now we can proceed normally. Create files where we need to
      // otherwise use the ones provided
      if (typeof unit === 'object') {

        // Create temp stuff
        var tmpDir = path.join(kbox.util.disk.getTempDir(), project);
        fs.mkdirpSync(tmpDir);

        // Generate a new compose file and add to our thing
        var fileName = [project, _.uniqueId()].join('-') + '.yml';
        var newComposeFile = path.join(tmpDir, fileName);
        kbox.util.yaml.toYamlFile(unit, newComposeFile);
        unit = newComposeFile;

      }

      // Add in our unit
      files.push('--file');
      files.push(unit);

    });

    // Return all the files
    return files;

  };

  /*
   * Expand dirs/files to an array of kalabox-compose files options
   */
  var parseComposeOptions = function(compose, project, opts) {

    // A project is required
    if (!project) {
      throw new VError('Need to give this composition a project name!');
    }

    // Kick off options
    var options = ['--project-name', project];

    // Get our array of compose files
    var files = parseComposeData(compose, project, opts);

    // Return our compose option
    return options.concat(files);

  };

  /*
   * Parse general docker options
   */
  var parseOptions = function(opts) {

    // Start flag collector
    var flags = [];

    // Return empty if we have no opts
    if (!opts) {
      return flags;
    }

    // Daemon opts
    if (opts.background) {
      flags.push('-d');
    }

    // Recreate opts
    if (opts.recreate) {
      flags.push('--force-recreate');
    }

    // Removal opts
    if (opts.force) {
      flags.push('--force');
    }
    if (opts.volumes) {
      flags.push('-v');
    }

    // Run options
    // Do not start linked containers
    if (opts.noDeps) {
      flags.push('--no-deps');
    }
    // Change the entrypoint
    if (opts.entrypoint) {
      flags.push('--entrypoint');
      flags.push(opts.entrypoint);
    }
    // Remove the container after the run is done
    if (opts.rm) {
      flags.push('--rm');
    }
    // Add additional ENVs
    if (opts.environment) {
      _.forEach(opts.environment, function(e) {
        flags.push('-e ' + e);
      });
    }

    // Return any and all flags
    return flags;

  };

  /*
   * Helper to standarize construction of docker commands
   */
  var buildCmd = function(compose, project, run, opts) {

    // Get our compose files and build the pre opts
    var cmd = parseComposeOptions(compose, project, opts).concat([run]);

    // Get options
    cmd = cmd.concat(parseOptions(opts));

    // Add in a service arg if its there
    if (opts && opts.service) {
      cmd.push(opts.service);
    }

    // Add in a command arg if its there
    if (opts && opts.cmd) {
      cmd = cmd.concat(opts.cmd);
    }

    return cmd;

  };

  /*
   * You can do a create, rebuild and start with variants of this
   */
  var up = function(compose, project, opts) {

    // Default options
    var defaults = {
      background: true,
      recreate: false
    };

    // Get opts
    var options = opts || {};

    // Merge in defaults
    options = _.merge(defaults, options);

    // Up us
    return shCompose(buildCmd(compose, project, 'up', options));

  };

  /*
   * Run docker compose pull
   */
  var getId = function(compose, project, opts) {
    var binOpts = {silent: true};
    return shCompose(buildCmd(compose, project, 'ps -q', opts), binOpts);
  };

  /*
   * Run docker compose build
   */
  var build = function(compose, project, opts) {
    return shCompose(buildCmd(compose, project, 'build', opts));
  };

  /*
   * Run docker compose pull
   */
  var pull = function(compose, project, opts) {
    return shCompose(buildCmd(compose, project, 'pull', opts));
  };

  /*
   * Run docker compose stop
   */
  var stop = function(compose, project, opts) {
    return shCompose(buildCmd(compose, project, 'stop', opts));
  };

  /*
   * Run docker compose remove
   */
  var remove = function(compose, project, opts) {

    // Default options
    var defaults = {
      force: true,
      volumes: false
    };

    // Get opts
    var options = opts || {};

    // Merge in defaults
    options = _.merge(defaults, options);

    return shCompose(buildCmd(compose, project, 'rm', options));
  };

  /*
   * Run docker compose run
   */
  var run = function(compose, project, opts) {

    // Default options
    var defaults = {
      entrypoint: '"/bin/sh -c"',
      environment: [],
      noDeps: false,
      rm: true,
      cmd: ''
    };

    // Get opts
    var optz = opts || {};

    // GEt whether we want to attach or not
    var attach = (optz && optz.attach) ? true : false;

    // Merge in defaults
    optz = _.merge(defaults, optz);

    // Execute
    return shCompose(buildCmd(compose, project, 'run', optz), {attach: attach});

  };

  // Build module function.
  return {
    getId: getId,
    build: build,
    pull: pull,
    start: up,
    stop: stop,
    run: run,
    remove: remove
  };

};
