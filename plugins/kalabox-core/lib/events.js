'use strict';

module.exports = function(kbox) {

  // Node modules
  var format = require('util').format;

  // Npm modules
  var rest = require('restler');

  // Kalabox modules
  var Promise = kbox.Promise;

  // Logging
  var log = kbox.core.log.make('CORE PLUGIN');

  /*
   * App events
   */
  kbox.core.events.on('post-app-load', function(app) {

    /**
     * Ping the site until its ready to go
     * This avoids a preemptive 50* error showing up at the sites url
     */
    app.events.on('post-start', 8, function() {

      app.status('Waiting for site to be ready.');

      // Attempt the request and retry a few times
      return Promise.retry(function() {

        // Grab the URL we want to check
        var site = app.url;

        // Log the attempt
        log.debug(format('Checking to see if %s is ready.', site));

        // Send REST request.
        return new Promise(function(fulfill, reject) {

          // Make the actual request
          rest.get(site)

          // Log result and fulfil promise
          .on('success', function(data) {
            log.debug(format('%s is now ready.', site));
            fulfill(data);
          })

          // Throw an error on fail/error
          .on('fail', function(data, response) {
            var code = response.statusCode;
            log.debug(format('%s not yet ready with code %s.', site, code));
            reject(new Error(response));
          }).on('error', reject);

        });

      }, {max: 50});

    });

  });

};
