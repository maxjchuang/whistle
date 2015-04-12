var util = require('../../util');
var url = require('url');
var net = require('net');
var dns = require('dns');
var extend = require('util')._extend;

var rules = [];
var hosts = [];
var heads = [];

function parse(text) {
	rules = [];
	hosts = [];
	heads = [];
	if (!text || !(text = text.trim())) {
		return;
	}
	
	text.split(/\n|\r\n|\r/g).forEach(pareLine);
}

function pareLine(line) {
	line = line.replace(/#.*$/, '').trim();
	if (!line) {
		return;
	}
	
	line = line.split(/\s+/);
	var pattern = line[0];
	if (net.isIP(pattern) || (util.hasProtocol(pattern) && !/^https?:\/\//.test(pattern))) {
		line.slice(1).forEach(function(matcher) {
			parseRule(matcher, pattern);
		});
	} else if (!util.isRegExp(pattern) && util.isRegExp(line[1])) {
		parseRule(line[1], pattern);
	} else {
		parseRule(pattern, line[1]);
	}
}

function parseRule(pattern, matcher) {
	if (!pattern || !matcher) {
		return;
	}
	
	var isIP = net.isIP(matcher);
	var isRegExp = util.isRegExp(pattern);
	var protocol;
	if (!isRegExp) {
		protocol = util.getProtocol(pattern);
		
		if (!isIP) {
			if (pattern.indexOf('/', protocol == null ? 0 : pattern.indexOf('://') + 3) == -1) {
				pattern += '/';
			}
		} else if (!(pattern = util.getHost(pattern))) {
			return;
		}
	} else if (!(pattern = util.toRegExp(pattern))) {
		return;
	}
	
	var rule = {
			isRegExp: isRegExp,
			protocol: protocol,
			pattern: pattern,
			matcher: matcher
		};
	
	if (isIP) {
		hosts.push(rule);
	} else if (/^head:\/\//.test(matcher)) {
		heads.push(rule);
	}else {
		rules.push(rule);
	}
}

exports.parse = parse;

function resolve(_url, callback) {
	var rule = {};
	var matchedUrl = resolveRule(_url, rule);
	var error, done;
	var matcher = matchedUrl || _url;
	var options = url.parse(matcher);
	var hosts = options.hosts = [];
	options.url = matcher;
	options.rule = rule;
	options.hasMatcher = !!matchedUrl;

	if (matchedUrl) {
		resolveHost(matchedUrl, function(err, ip) {
			hosts[1] = ip;
			error = err;
			execCallback();
		});
		
		hosts[0] = null;
		execCallback();
	} else {
		resolveHost(_url, function(err, ip) {
			hosts[0] = ip;
			if (!matchedUrl) {
				hosts[1] = ip;
				error = err;
			}
			execCallback();
		});
	}
	
	function execCallback() {
		if (!done && (error || (typeof hosts[0] != 'undefined' && typeof hosts[1] != 'undefined'))) {
			done = true;
			hosts[1] = hosts[1] || hosts[0];
			hosts[0] = hosts[0] || hosts[1];
			callback(error, options);
		}
	}
}

exports.resolve = resolve;

function resolveHost(_url, callback) {
	var options = _url ? url.parse(util.setProtocol(_url)) : {};
	var protocol = options.protocol;
	if (!util.isWebProtocol(protocol)) {
		callback(null, null);
		return;
	}
	var hostname = options.hostname;
	for (var i = 0, host; host = hosts[i]; i++) {
		if (host.isRegExp ? host.pattern.test(_url) : (hostname == host.pattern && (!host.protocol || host.protocol == protocol))) {
			callback(null, host.matcher);
			return;
		}
	}
	
	try {
		dns.lookup(hostname, function(err, ip, addressType) {
		      callback(err, err ? null : (ip || (!addressType || addressType === 4 ? '127.0.0.1' : '0:0:0:0:0:0:0:1')));
		  });
	} catch(err) {//如果断网，可能直接抛异常，https代理没有用到error-handler
		callback(err);
	}
}

exports.resolveHost = resolveHost;

function resolveRule(url, data, _rules) {
	data = data || {};
	_rules = _rules || rules;
	var _url = url.replace(/(?:\?|#).*$/, '');
	for (var i = 0, rule; rule = _rules[i]; i++) {
		var pattern = rule.pattern;
		if (rule.isRegExp) {
			if (pattern.test(url)) {
				var regExp = {};
				for (var i = 0; i < 10; i++) {
					regExp['$' + i] = RegExp['$' + i] || '';
				}
				extend(data, rule);
				return setProtocol(rule.matcher.replace(/(^|.)?(\$[1-9])/g, 
						function(matched, $1, $2) {
					return $1 == '\\' ? $2 : ($1 || '') + regExp[$2];
				}), url);
			}
		} else {
			pattern = setProtocol(pattern, url);
			if (_url.indexOf(pattern) === 0) {
				var len = pattern.length;
				if (pattern == _url || isPathSeparator(_url[len]) || isPathSeparator(pattern[len - 1])) {
					extend(data, rule);
					return join(setProtocol(rule.matcher, url), url.substring(len));
				}
			}
		}
	}
}

function setProtocol(target, source) {
	if (util.hasProtocol(target)) {
		return target;
	}
	
	var protocol = util.getProtocol(source);
	if (protocol == null) {
		return target;
	}
	
	return protocol + '//' + target;
}

exports.resolveRule = resolveRule;

function resolveHead(url, data) {
	return resolveRule(url, data, heads);
}

exports.resolveHead = resolveHead;

function isPathSeparator(ch) {
	return ch == '/' || ch == '\\';
}

function join(first, last) {
	if (!first || !last) {
		return first + last;
	}
	
	var len = first.length - 1;
	if (isPathSeparator(first[len])) {
		return isPathSeparator(last[0]) ? first.substring(0, len) + last : first + last;
	}
	
	return isPathSeparator(last[0]) ? first + last : first + '/' + last;
}
