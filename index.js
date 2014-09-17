var through = require('through');
var path = require('path');
var gutil = require('gulp-util');
var doT = require('dot');
var fs = require('fs');
var PluginError = gutil.PluginError;
var File = gutil.File;

module.exports = function(opt) {
    if (!opt) opt = {};
    if (!opt.fileName) throw new PluginError('gulp-dotjs-packer', 'Missing fileName option for gulp-dotjs-packer');
    if (!opt.newLine) opt.newLine = gutil.linefeed;
    if (!opt.variable) opt.variable = "JST";
    if (!opt.processName) opt.processName = function(pathName, base, cwd) {
        return pathName.replace(base, "").replace(path.extname(pathName), "");
    };
    if (!opt.templateSettings) opt.templateSettings = doT.templateSettings;
    if (!opt.templateName) opt.templateName = false;
    if (!opt.templateSuffix) opt.templateSuffix = false;
    // RequireJS
    if (!opt.requirejs) opt.requirejs = false;
    if (!opt.requirejsNamespace) opt.requirejsNamespace = false;
    if (!opt.requirejsModuleName) opt.requirejsModuleName = false;

    var buffer = [];
    var firstFile = null;
    var fileName = opt.fileName;
    var processName = opt.processName;
    var variable = opt.variable;
    var templateSettings = opt.templateSettings;

    //
    var loadRegex = /\{\{\#\#\s*(def\.\w+)\s*\:\s*load\(['|"](.*?)['|"]\,?\s*(\{\s*(.*?\s*?)+?\})?\s*\);?\s*\#?\}\}/g;


    /**
     * Load partials.
     */

    var loadPartial = function(m, filePath, loadPath, fullPath, obj) {
        var customVars = {}, _this = this, pendingPartialLoads = {};
        console.log('loadPartial', filePath, loadPath, path.resolve(path.dirname(fullPath), loadPath));

        var _filePath = path.resolve(path.dirname(fullPath), loadPath);
        var content = fs.readFileSync(_filePath, 'utf8').replace(/<\!\-\-(.|\n)*\!\-\->/g, '');

        if(loadRegex.test(content)) {
            _filePath = _filePath.replace(_this.opt.gruntRoot, '');
            content = content.replace(this.loadRegex, function(m, namespace, loadPath, obj) {
                var content = loadPartial(m, _filePath, loadPath, obj);
                pendingPartialLoads[namespace] = content;
                return '';
            });
        }

        if(typeof obj !== 'undefined') {
            var matches = obj.match(/(\w+)\s*\:(.*)\s*/g);
            for(var i = 0; i < matches.length; i++) {
                var _matches = /(\w+)\s*\:(.*)\s*/g.exec(matches[i])
                    , key = _matches[1]
                    , value = _matches[2].replace(/'|"|\,|\s*/g, '')
                    , regex = new RegExp('\\{\\{\\$\\s*(' + key + ')\\s*\\:?\\s*(.*?)\\s*\\}\\}', 'g');

                content = content.replace(regex, function(m, key, defaultValue) {
                    if(typeof value === 'undefined' && typeof defaultValue === 'undefined') {
                        return '';
                    } else if(typeof val !== 'undefined') {
                        return defaultValue;
                    } else {
                        return value;
                    }
                });
            }
        }

        content = loadPendingPartials(content, pendingPartialLoads);
        content = setDefaultValues(content);

        return content;
    };

    var setDefaultValues = function(content) {
      content = content
        .replace(/\{\{\$\s*\w*?\s*\:\s*(.*?)\s*\}\}/g, function(m, p1) {
          return p1;
        })
        .replace(/\{\{\$(.*?)\}\}/g, function() {
          return '';
        });
      return content;

    }

    /**
     * Loads pending partials.
     */

    var loadPendingPartials = function(content, pendingPartialLoads) {
    console.log('loadPendingpartials');
      for(var namespace in pendingPartialLoads) {
        content = content.replace(
          new RegExp('\\{\\{\\#\\s*' + namespace + '\\s*\\}\\}', 'g'),
          function(m) {
            return pendingPartialLoads[namespace];
          });
      }
      return content;
    };

    /**
     * Get file content.
     */

    var getFileContent = function(content, filePath, fullPath) {
      var _this = this, pendingPartialLoads = {};

      // Log file path
      console.log('getFileContent', filePath, fullPath);

      // Return file content
      content = content
        .replace(/^(?!.*:\/\/$).*\/\/.*/, '')
        .replace(loadRegex, function(m, namespace, loadPath, fullpath, obj) {
          var content = loadPartial(m, filePath, loadPath, fullPath, obj);
          pendingPartialLoads[namespace] = content;
          return '';
        })
        .replace(/<\!\-\-(.|\n)*\!\-\->/g, '')
        .replace(/^\s+|\s+$|[\r\n]+/gm, '')
        .replace(/\/\*.*?\*\//gm,'');


      content = loadPendingPartials(content, pendingPartialLoads);
      return content;
    };

    //
    //
    function handleCompile(content, settings, defs, variable, file, fullPath) {
        console.log('call getFileContent', fullPath, 'path:' + file);
        var content = getFileContent(content, file, fullPath);

        var template = "";
        var compiled = doT.template(content, settings, defs).toString();
        var templateSuffix = (opt.templateSuffix ? opt.templateSuffix : '');

        var templateName = (opt.templateName && typeof opt.templateName == 'function' ? opt.templateName(fullPath) : path.basename(path.join(fullPath, '.'), '.jst'))
        templateName = templateName + templateSuffix;

                console.log('tempalteNAme', templateName);
        template += variable + "['" + templateName + "'] = " + compiled;
        return template;
    }

    function proccessContents(contents) {
        return contents.toString('utf8')
    }

    function bufferContents(file) {
        if (file.isNull()) return this.emit('error', new PluginError('gulp-dotjs-packer', 'No files to compile'));
        if (file.isStream()) return this.emit('error', new PluginError('gulp-dotjs-packer', 'Streaming not supported'));

        if (!firstFile) firstFile = file;
        buffer.push(handleCompile(proccessContents(file.contents), templateSettings, {}, variable, processName(file.path, file.base, file.cwd), file.path));
    }

    function endStream() {
        if (buffer.length === 0) return this.emit('end');

        var joinedContents = buffer.join(opt.newLine);
        // Implemente RequireJS + Namespace
        var define = (opt.requirejsNamespace ? opt.requirejsNamespace + '.define' : 'define');
        var moduleName = (opt.requirejsModuleName ? opt.requirejsModuleName : 'templates');
        console.log('rjs namespace:', opt.requirejsNamespace, opt.requirejsModuleName, define);
        var header = define + "('" + moduleName + "', [], function() {";
        //var header = define + '(function() {';
            // Encode HTML
            header += 'function e() {var r={"&":"&#38;","<":"&#60;",">":"&#62;",\'"\':\'&#34;\',"\'":\'&#39;\',"/":\'&#47;\'}, reg = /&(?!#?\w+;)|<|>|"|\'|\\//g;return function() {return this ? this.replace(reg, function(m) {return r[m] || m;}) : this;};};String.prototype.encodeHTML=e();';

            // Add template name if present
            header += variable + " = window." + variable + " || {};";
            // Finally join content
            header += joinedContents + ";return " + variable + "; });";

        //var content = "(function(root, factory) { if (typeof define === 'function' && define.amd) { define(factory); } else { root['" + variable + "'] = factory(); } }(this, function() {\r\nvar " + variable + " = " + variable + " || {}; \r\n" + joinedContents + " \r\nreturn " + variable + "; \r\n}));"


        var joinedPath = path.join(firstFile.base, fileName);

        var joinedFile = new File({
            cwd: firstFile.cwd,
            base: firstFile.base,
            path: joinedPath,
            contents: new Buffer(header)
        });

        this.emit('data', joinedFile);
        this.emit('end');
    }

    return through(bufferContents, endStream);
};
