
var org = org || {};
org.anclab = org.anclab || {};
org.anclab.steller = org.anclab.steller || {};

org.anclab.steller = (function (window, namespace) {

    /**
     * SoundModel
     *
     * A "sound model" is a graph node with support for parameters.
     *
     * @param obj The object to turn into a "sound model"
     * 
     * @param inputs Array of graph nodes (or sound models) that constitute
     * the input for this model.
     *
     * @param outputs The array of graph nodes (or sound models) that constitute
     * the output for this model.
     *
     * By making the inputs and outputs explicit, we can make
     * sound models whose output can be piped through other models
     * before it hits the audio context's destination.
     *
     * Sound models are scheduled using the Scheduler (org.anclab.steller.Scheduler)
     */
    function SoundModel(obj, inputs, outputs) {
        return Parameterize(GraphNode(obj, inputs, outputs));
    };

    /**
     * GraphNode
     *
     * Makes an object into a node that can be used in a signal
     * processing graph with the Web Audio API.
     * 
     * node = an object that you want to quack like a node.
     * inputs = array of nodes that have open inputs in the graph.
     * outputs = array of nodes that have open outputs in the graph.
     *
     * For simplicity. I provide a "strict" version of multichannel
     * support for illustration, but you may want something
     * smarter with auto-fanout, auto-mixdown, etc.
     *
     * Note that the graphNode is compositional in nature - i.e. you can
     * treat smaller node graphs as nodes in a larger nor graph, which is what 
     * you want, I guess.
     * 
     * The above implementation has a disadvantage due to the fact that the 
     * protocol for determining pins *inside* an AudioNode is not exposed. 
     * Therefore you can connect the output of a wrapped node to an input of 
     * a regular AudioNode, but not vice versa. However, you can wrap any
     * plain AudioNode "n" using "GraphNode({}, [n], [n])" after which
     * you'll have to deal with only wrapped nodes ... and all is well :)
     * 
     * Of course, if you're wrapping all audio nodes anyway, you're free to
     * depart from the "connect" protocol and implement it any way you like :D
     */
    function GraphNode(node, inputs, outputs) {
        node.inputs             = inputs || [];
        node.outputs            = outputs || [];

        node.numberOfInputs     = node.inputs.length;
        node.numberOfOutputs    = node.outputs.length;

        // Same function signature as with the Web Audio API's AudioNode.
        node.connect = function (target, outIx, inIx) {
            var i, N, inPin, outPin;

            // Set default output pin indices to 0.
            outIx = outIx || 0;
            inIx = inIx || 0;
            outPin = node.outputs[outIx];

            // The "receiving pin" could be a simple AudioNode
            // instead of a wrapped one.
            inPin = target.inputs ? target.inputs[inIx] : target;

            console.assert(inPin.numberOfInputs === outPin.numberOfOutputs);

            for (i = 0, N = inPin.numberOfInputs; i < N; ++i) {
                outPin.connect(inPin, i, i);
            }
        };

        // Same function signature as with the Web Audio API's AudioNode.
        // ... but we also support providing the pin numbers to disconnect
        // as arguments.
        node.disconnect = function () {
            if (arguments.length > 0) {
                // Disconnect only the output pin numbers identified in
                // the arguments list.
                Array.prototype.forEach.call(arguments, function (n) {
                    node.outputs[n].disconnect();
                });
            } else {
                // Disconnect all output pins. This is also the 
                // behaviour of AudioNode.disconnect()
                node.outputs.forEach(function (n) { n.disconnect(); });
            }
        };

        var preservedNodes = [];

        // Stop-gap arrangement to keep around a reference to a node to prevent it
        // from being garbage collected by the system. Call keep(node) to hold a 
        // reference to it and drop(node) to drop all references to it.

        node.keep = function (node) {
            preservedNodes.push(node);
            return node;
        };

        node.drop = function (node) {
            preservedNodes = preservedNodes.filter(function (n) { return n !== node; });
        };

        return node;
    }


    /**
     * Parameterize 
     *
     * Adds a "params" field to the object which contains 
     * information about the object's parameters and methods
     * for defining and exposing params on the object.
     *
     * obj.params.specs = object giving specifications of parameters.
     * obj.params.define({..spec..}) 
     *      Defines a parameter on "obj" according to the given spec.
     * obj.params.expose(obj2, ..optnames..)
     *      Exposes parameters in obj2 as parameters of obj.
     * obj.params.exposeAs(obj2, name, newName)
     *      Exposes an existing parameter of obj2, but gives it a new name
     *      in obj.
     *
     * Usage:
     *
     *      var obj = ...
     *      Parameterize(obj);
     *      obj.params.define({name: "gain", min: 0.01, max: 1.0, value: 0.25});
     *      // See define below for more ways to specify a parameter.
     *
     *      // Setting a parameter's value.
     *      obj.gain.value = 0.5;
     *
     * Chaining:
     *  
     *  The functions exposed via obj.params are chainable. For example,
     *
     *      obj.params.define({name: "blah", ...}).watch("blah", function (val) {...})
     *
     *  ... and so on. The params object holds a reference to the object whose parameters
     *  it manages in its 'object' field, so if you wish to get the managed object at the end
     *  of the chain, you can write -
     *
     *      obj.params.define({name: "blah", ...}).watch("blah", function (val) {...}).object
     */
    function Parameterize(obj) {
        var p = {};
        var specs = {};
        p.specs = specs;
        obj.params = p;

        function specifyParam(spec) {
            specs[spec.name] = spec;

            // A parameter's value is accessed as obj.myParam.value.
            // Also supports the "valueOf" protocol.
            var pobj = {};
            pobj.__defineGetter__('value', spec.getter);
            pobj.__defineSetter__('value', spec.setter);
            pobj.valueOf = spec.getter;

            obj[spec.name] = pobj;

            return p;
        }

        /**
         * Adds a new parameter definition.
         *
         * spec = {
         *      name: "paramname",
         *      min: smallestValue,
         *      max: largestValue,
         *      getter: function () { return actualValue; },
         *      setter: function (val) { actualValue = val; return val; }
         *  }
         *
         *  As a shorcut, you can provide an "audioParam" field
         *  and pass an AudioParam object there instead of giving a
         *  getter and setter.
         *
         *  If you just want to define a raw parameter, you can just
         *  provide a 'value' field in the spec. That value will be
         *  used as the default.
         */
        function define(spec, name) {
            name = name || spec.name;
            validName(name);

            // Make another spec so that we don't change the original 
            // when we add stuff to it. 
            spec = Object.create(spec);
            spec.name = name; // Given or new name.

            // Keep around a list of watchers - i.e. callbacks to call
            // when the value of the parameter is set.
            var watchers = [];
            spec.watchers = watchers;

            function limit(val) {
                return Math.max(spec.min, Math.min(val, spec.max));
            }

            function observe(val) {
                var i, N;
                for (i = 0, N = watchers.length; i < N; ++i) {
                    watchers[i](val, name, obj);
                }
                return val;
            }

            spec.getter = spec.getter 
                || (spec.audioParam && function () { return spec.audioParam.value; })
                || ('value' in spec && function () { return spec.value; });

            if (spec.setter) {
                // Add support for limiting the parameter value 
                // when it is being set.
                spec.setter = (function (givenSetter) {
                    return function (val) {
                        return observe(givenSetter(limit(val)));
                    };
                }(spec.setter));
            } else if (spec.audioParam) {
                spec.setter = function (val) {
                    return observe(spec.audioParam.value = limit(val));
                };
            } else if ('value' in spec) {
                spec.setter = function (val) {
                    return observe(spec.value = limit(val));
                };
            }

            return specifyParam(spec);
        }

        /**
         * Installs the callback (= function (value, paramName, object) {}) as an observer 
         * that gets called whenever the parameter's value gets set. Useful for updating
         * GUI controls or determining the values of derived parameters.
         *
         * The argument order is so that you can write param-specific callbacks as 
         * function (value) {...}, or object-specific callbacks as 
         * function (value, paramname) {...} or generic callbacks as 
         * function (value, paramName, object) {...}. 
         *
         * Returns the main object for call chaining.
         */
        function watch(name, callback) {
            var spec = specs[name];
            if (!spec) {
                throw new Error("Invalid parameter name - " + name);
            }

            var watchers = spec.watchers, i, N;

            // Make sure the callback isn't already installed.
            for (i = 0, N = watchers.length; i < N; ++i) {
                if (watchers[i] === callback) {
                    return obj;
                }
            }

            watchers.push(callback);
            return p;
        }

        /**
         * Removes the given callback as an observer for the parameter.
         * If no callback is specified, it removes *all* observers.
         * Returns obj for call chaining.
         */
        function unwatch(name, callback) {
            var spec = specs[name];
            if (!spec) {
                throw new Error("Invalid parameter name - " + name);
            }

            var watchers = spec.watchers;

            if (arguments.length < 2 || !callback) {
                // Remove all watchers.
                watchers.splice(0, watchers.length);
                return obj;
            }

            // Remove the installed watcher. Note that we only need
            // to check for one watcher because watch() will never 
            // add duplicates.
            for (var i = watchers.length - 1; i >= 0; --i) {
                if (watchers[i] === callback) {
                    watchers.splice(i, 1);
                    return obj;
                }
            }

            return p;            
        }

        /**
         * Makes the parameters in another object available through
         * this one as well.
         *
         * params.exposeParams(otherParams, 'name1', 'name2', ...)
         *
         * If you omit the names, all parameters will be exposed.
         */
        function expose(obj2) {
            var i, N, spec;
            console.assert(obj2 && obj2.params && obj2.params.specs);

            if (arguments.length === 1) {
                // Expose all params from the given set.
                Object.keys(obj2.params.specs).forEach(function (name) {
                    define(obj2.params.specs[name]);
                });
            } else {
                // Expose only parameters with the given names.
                for (i = 1, N = arguments.length; i < N; ++i) {
                    define(obj2.params.specs[arguments[i]]);
                }
            }

            return p;
        };

        /**
         * Exposes the named parameter in params using a new name.
         * Can only do one at a time.
         */
        function exposeAs(params, name, newName) {
            return define(params.specs[name], newName);
        }

        p.define    = define;
        p.watch     = watch;
        p.unwatch   = unwatch;
        p.expose    = expose;
        p.exposeAs  = exposeAs;
        p.object    = obj;

        return obj;
    }

    // Utilities
    var dummyObject = {params: true, length: 1};
    function validName(name) {
        // We prohibit parameter names such as "constructor",
        // "hasOwnProperty", etc.
        if (dummyObject[name]) {
            throw new Error("Invalid param name [" + name + "]");
        }

        return name;
    }

    /**
     * Scheduler
     *
     * This is a simple scheduler for "models" .. which are functions
     *  of the form --
     *       function (sched, t1, t2, next) {
     *           // ... do something
     *           next(sched, t1, t2, sched.stop); // Go to the next one if you wish.
     *       }
     *   where --
     * 
     *   'sched' is the scheduler object.
     *   't1-t2' is the interval for which the call is being made.
     *   'next' is the model that is supposed to follow this one in time.
     * 
     *   To use the scheduler, you first make an instance using "new".
     *
     *      var sh = new Scheduler;
     *
     *   Then you start it running by setting the 'running' property to true.
     *
     *      sh.running = true;
     *
     *   Then you can play models already. Here is something that will keep
     *   outputting 'fizz', 'buzz' alternately every 2 seconds.
     *
     *      var p = Parameterize({});
     *      p.params.define({name: 'dur', min: 0.01, max: 60, value: 2});
     *      var fizzbuzz = sh.loop(sh.track([
     *          sh.log('fizz'), sh.delay(p.dur), 
     *          sh.log('buzz'), sh.delay(p.dur)
     *      ]));
     *      sh.play(fizzbuzz);
     * 
     *  Now try changing the value of the duration parameter p.dur like below
     *  while the fizzes and buzzes are being printed out --
     *      
     *      p.dur.value = 1
     */
    function Scheduler(audioContext, options) {
        // Make sure we don't clobber the global namespace accidentally.
        var self = (this === window ? {} : this);
        var Timer = PeriodicTimer; // or JSNodeTimer

        // How long is an "instant"?
        var instant_secs = 0.001;

        var time_secs = (function () {
            if (!audioContext) {
                return function () {
                    return Date.now() * 0.001;
                };
            } else if (audioContext.constructor.name === 'AudioContext') {
                instant_secs = 1 / audioContext.sampleRate;
                return function () {
                    return audioContext.currentTime;
                };
            } else {
                throw new Error("Scheduler: Argument is not an audio context");
            }
        }());


        var timer, running = false;

        // To start the scheduler, set "scheduler.running = true"
        // To stop it, set it to false.
        self.__defineGetter__('running', function () { return running; });
        self.__defineSetter__('running', function (state) {
            if (state) {
                if (!running) {
                    running = true;
                    clock.jumpTo(time_secs());
                    timer.start();
                }
            } else {
                running = false;
                timer.stop();
            }
        });


        // A pair of arrays used as an event tick queue.
        // Models placed in queue are processed and the resultant
        // models scheduled go into the requeue. Then after one
        // such cycle, the variables are swapped.
        var queue = [];
        var requeue = [];

        function flush() {
            queue.splice(0, queue.length);
            requeue.splice(0, requeue.length);
        }

        // Keep track of time.
        var clockDt = 0.05; // Use a 50Hz time step.
        var clockBigDt = clockDt * 5; // A larger 10Hz time step.
        var clock = new Clock(time_secs(), 0, clockDt, 1.0);
        var now_secs;

        function scheduleTick() {
            // Main scheduling work happens here.
            var i, N, tmpQ;
            now_secs = time_secs() + clockDt;

            // If lagging behind, advance time before processing models.
            while (now_secs - clock.t1 > clockBigDt) {
                clock.advance(clockBigDt);
            }

            while (clock.t1 < now_secs) {
                tmpQ = queue;
                queue = requeue;

                // Process the scheduled tickers. The tickers
                // will know to schedule themselves and for that
                // we pass them the scheduler itself.
                for (i = 0, N = tmpQ.length; i < N; ++i) {
                    tmpQ[i](self, clock, cont);
                }

                tmpQ.splice(0, tmpQ.length);
                requeue = tmpQ;
                clock.tick();
            }
        }

        // scheduleTick needs to be called with good solid regularity.
        // If we're running the scheduler under node.js, it can only
        // be because MIDI is needed, which needs high precision,
        // indicated by 0.
        timer = new Timer(scheduleTick, 0, audioContext);

        // Schedules the model by placing it into the processing queue.
        function schedule(model) {
            if (model) {
                queue.push(model);
            }
        }

        // Wraps the concept of "performing" a model so that
        // the representation of the model as a continuation 
        // is not strewn all over the place. Note that the
        // "current scheduler" is used by perform via "this",
        // so perform *must* be called like a method on the 
        // scheduler.
        function perform(model, clock, next) {
            model(this, clock, next);
        }

        // Having constructed a model, you use play() to play it.
        // The playing starts immediately. See 'delay' below if you want
        // the model to start playing some time in the future.
        function play(model) {
            this.perform(model, clock.copy(), stop);
        }

        // This "model" says "stop right here, nothing more to do."
        // This is the "zero" of the algebra. No model placed after a stop
        // in a sequence will get to run.
        function stop(sched, clock, next) {
        }

        // This "model" just says "continue on with whatever's next".
        // This is the "one" of the algebra. Placing it anywhere in
        // a sequence has no consequence on it.
        function cont(sched, clock, next) {
            next && sched.perform(next, clock, stop);
        }

        // Gives a model that introduces the given amount of delay in a
        // sequence. Notice that the "valueOf" protocol on dt is used. This
        // lets us introduce fixed as well as variable delays. This is the
        // absolute *core* of the "scheduler" since it is the only function
        // which actually does something about invoking stuff at a specified
        // time! Any optimization of the scheduling loop will also involve this
        // function and, likely, this one *only*.
        //
        // Example:
        //
        //      sh.play(sh.track(sh.delay(1), model))
        //
        // Will cause the model to play after 1 second.
        //
        // If callback is provided, it will be called throughout the wait
        // period with the arguments (t1, t2, startTime, endTime) giving the
        // interval for which it is being called. Continuous parameter
        // animations can be handled using the callback, for example.
        function delay(dt, callback) {
            return function (sched, clock, next) {
                var startTime = clock.t1r;
                (function tick(sched, clock) {
                    var endTime = startTime + dt.valueOf();

                    // If lagging behind, advance time before processing models.
                    while (now_secs > clock.t1) {
                        clock.advance(now_secs - clock.t1);
                    }

                    if (clock.t2r < endTime) {
                        if (callback) {
                            callback(clock, clock.t1r, clock.t2r, startTime, endTime);
                        }
                        schedule(function (sched, clockT) {
                            sched.perform(tick, clock.tick());
                        });
                    } else {
                        if (callback && endTime >= clock.t1r) {
                            callback(clock, clock.t1r, endTime, startTime, endTime);
                        }
                        if (clock.t2r > clock.t1r) {
                            sched.perform(next, clock.nudgeToRel(endTime), sched.stop);
                        } else {
                            sched.perform(next, clock, sched.stop);
                        }
                    }
                }(sched, clock));
            };
        }

        // The two given models will be performed in sequence.
        // When the first model ends, it will transfer control
        // to the second model. 
        //
        // Note: This is an internal combinator exposed via the
        // more convenient "track".
        function seq(model1, model2) {
            return function (sched, clock, next) {
                sched.perform(model1, clock, seq(model2, next));
            };
        }

        // Here is a model that will never end. The given model
        // will be looped forever. You better have a delay in 
        // there or you'll get an infinite loop or blow the stack
        // or something like that.
        function loop(model) {
            return function looper(sched, clock, next) {
                sched.perform(model, clock, looper);
            };
        }

        // The models in the given array are spawned off simultanously.
        // When all the models finish their work, the fork will
        // continue on with whatever comes next.
        //
        //  Ex:     sh.play(sh.track(sh.fork([drumpat1, drumpat2]), drumpat3));
        //  That will cause pat1 to be played simultaneously with pat2
        //  and when both finish, pat3 will play.
        //
        //  Support both fork(a, b, c, ..) and fork([a, b, c, ..]) forms.
        //
        function fork(models) {
            if (models && models.constructor === Function) {
                // We're given the models as arguments instead of an array.
                models = Array.prototype.slice.call(arguments, 0);
            } else {
                models = models.slice(0);
            }
            return function (sched, clock, next) {
                var syncCount = 0;
                function join(sched, clockJ) {
                    syncCount++;
                    if (syncCount === models.length) {
                        // All models have finished.
                        sched.perform(next, clock.jumpTo(clockJ.t1), sched.stop);
                    }
                };

                // Start off all models.
                models.forEach(function (model) {
                    sched.perform(model, clock.copy(), join);
                });
            };
        }

        // Similar to fork, except that the spawn will immediately
        // continue on with whatever is next, as though its duration
        // is zero.
        //
        // Support both spawn(a, b, c, ..) and spawn([a, b, c, ..]) forms.
        function spawn(models) {
            if (models && models.constructor === Function) {
                // We're given the models as arguments instead of an array.
                models = Array.prototype.slice.call(arguments, 0);
            } else {
                models = models.slice(0);
            }
            return function (sched, clock, next) {
                models.forEach(function (model) {
                    sched.perform(model, clock.copy(), sched.stop);
                });
                sched.perform(next, clock, sched.stop);
            };
        }

        // A generic 'dynamic model', which determines the
        // model to use at any given time according to some
        // rule. 'dyn' is a function (t1, t2) and is expected
        // to return a model, which is then scheduled. You can
        // use this, for example, to do random choices, conditional
        // choices, etc.
        function dynamic(dyn) {
            return function (sched, clock, next) {
                sched.perform(dyn(clock), clock, next);
            };
        }

        // Produces a model that consists of a sequence of
        // the given models (given as an array of models).
        // 
        // track([a,b,c,d]) is just short hand for
        // seq(a, seq(b, seq(c, d)))
        //
        // Support both track(a, b, c, ..) and track([a, b, c, ..]) forms.
        //
        // Note that the intermediate continuations are one-shot
        // and are not reusable for the sake of performance. If you
        // need reusable continuations, use trackR instead of track.
        function track(models) {
            if (models && models.constructor === Function) {
                // We're given the models as arguments instead of an array.
                models = Array.prototype.slice.call(arguments, 0);
            }

            if (!models || models.constructor !== Array || models.length === 0) {
                return cont;
            }

            if (models.length === 1) {
                return models[0];
            }

            return function (sched, clock, next) {
                var i = 0;
                sched.perform(function iter(sched, clock, _) {
                    if (i < models.length) {
                        sched.perform(models[i++], clock, iter);
                    } else {
                        sched.perform(next, clock, stop);
                    }
                }, clock, next);
            };
        }

        function trackR_iter(models, i, next) {
            if (i < models.length) {
                return function (sched, clock, _) {
                    sched.perform(models[i], clock, trackR_iter(models, i + 1, next));
                };
            } else {
                return next;
            }
        }

        // Functionally identical to track, but generates reusable
        // continuations on the fly. Not usually needed and track
        // is more memory efficient at doing what it does, but 
        // this could be useful for some interesting effects such as
        // canonization operators, or when you need to store away
        // a continuation and revisit it later. The "R" in the name
        // stands for "reusable continuations".
        function trackR(models) {
            if (models && models.constructor === Function) {
                // We're given the models as arguments instead of an array.
                models = Array.prototype.slice.call(arguments, 0);
            }

            if (!models || models.constructor !== Array || models.length === 0) {
                return cont;
            }

            if (models.length === 1) {
                return models[0];
            }


            return function (sched, clock, next) {
                sched.perform(trackR_iter(models, 0, next), clock, stop);
            };
        }

        // A model that simply fires the given call when it happens, takes
        // zero duration itself and moves on.
        function fire(callback) {
            return function (sched, clock, next) {
                callback(clock);
                sched.perform(next, clock, stop);
            };
        };

        // Useful logging utility.
        function log(msg) {
            return fire(function () {
                console.log(msg);
            });
        }

        // Parameter animation curves.
        //
        // anim(param, dur, func):
        // func is expected to be a function (t) where t is 
        // in the range [0,1]. The given parameter will be assigned
        // the value of the function over the given duration.
        //
        // anim(param, dur, v1, v2):
        // The parameter will be linearly interpolated over the given duration
        // starting with value v1 and ending with v2.
        //
        // anim(param, dur, v1, v2, interp):
        // The parameter will be interpolated from value v1 to value v2
        // over the given duration using the given interpolation function
        // interp(t) whose domain and range are both [0,1].
        //
        // Note that animation curves have a duration so that you
        // can sequence different curves using track().
        // If you want a bunch of parameters to animate simultaneously,
        // you need to use spawn() or fork().
        //
        // Also remember that the "dur" parameter can be anything
        // that supports "valueOf" protocol. That said, be aware that
        // varying the duration can result in the parameter jumping
        // values due to large changes in the fractional time. Sometimes,
        // that might be exactly what you want and at other times that
        // may not be what you want.
        function anim(param, dur) {
            var v1, v2, func, afunc;
            switch (arguments.length) {
                case 3: // Third argument must be a function.
                    afunc = arguments[2];
                    break;
                case 4: // Third and fourth arguments are starting
                    // and ending values over the duration.
                    v1 = arguments[2];
                    v2 = arguments[3];
                    afunc = function (f) { return v1.valueOf() + f * (v2.valueOf() - v1.valueOf()); };
                    break;
                case 5: // Third and fourth are v1, and v2 and fifth is
                    // a function(fractionalTime) whose return value is
                    // in the range [0,1] which is remapped to [v1,v2].
                    // i.e. the function is an interpolation function.
                    v1 = arguments[2];
                    v2 = arguments[3];
                    func = arguments[4];
                    afunc = function (f) { return v1.valueOf() + func(f) * (v2.valueOf() - v1.valueOf()); };
                    break;
                default:
                    throw new Error("Invalid arguments to anim()");
            }

            if (param.constructor.name === 'AudioGain' || param.constructor.name === 'AudioParam') {
                // Use linear ramp for audio parameters.
                return delay(dur, function (clock, t1, t2, startTime, endTime) {
                    var dt = endTime - startTime;
                    var t1f, t2f;
                    if (t1 <= startTime) {
                        t1f = dt > instant_secs ? (t1 - startTime) / dt : 1;
                        param.setValueAtTime(afunc(t1f), clock.rel2abs(t1));
                    }

                    t2f = dt > instant_secs ? (t2 - startTime) / dt : 1;
                    param.linearRampToValueAtTime(afunc(t2f), clock.rel2abs(t2));
                });
            } else {
                return delay(dur, function (clock, t1, t2, startTime, endTime) {
                    // Account for the fact that we're generating only one
                    // value for the parameter per call. This means the first
                    // call should have a fractional time of 0 and the last 
                    // one should have a fractional time of 1. We can make
                    // that happen if we assume that t2-t1 stays constant.
                    //
                    // The ideal behaviour would be to generate two values
                    // for each call and have the audio engine interpolate
                    // between them. The technique below serves as a stop-gap
                    // arrangement until then.
                    var dt = endTime - startTime - (t2 - t1);
                    if (dt > instant_secs) {
                        param.value = afunc((t1 - startTime) / dt);
                    } else {
                        // If we're generating only one value because the
                        // animation duration is very short, make it 
                        // the final value.
                        param.value = afunc(1);
                    }
                });
            }
        }

        // Changes the rate of progress of time through delays.  The given rate
        // "r" can be anything that supports the valueOf() protocol. The rate
        // value/parameter will flow along with the clock object that arrives
        // at this point - meaning it will affect all events that occur
        // sequenced with the rate control action. Note that fork() and spawn()
        // copy the clock before propagating. This means that each track within
        // a spawn/fork can have its own rate setting and that won't interfere
        // with the others. However, if you set a rate in the track that
        // contains the fork/spawn (and before them), the rate setting will
        // propagate to all the forked tracks by virtue of the clock copy.
        //
        // You need to be aware of whether the rate is being propagated "by
        // reference" or "by value". If the rate is a parameter, it gets
        // propagated by reference - i.e. changing the *value* of the rate
        // parameter in one track (clock.rate.value = num) affects the rate of
        // all the tracks that share the rate parameter. If it is a simple
        // number, then it gets propagated by value - i.e. "clock.rate = num" in
        // one track won't change the rate for the other tracks.
        function rate(r) {
            return function (sched, clock, next) {
                clock.rate = r;
                sched.perform(next, clock, sched.stop);
            };
        }

        self.audioContext = audioContext;
        self.perform    = perform;
        self.flush      = flush;
        self.play       = play;
        self.stop       = stop;
        self.cont       = cont;
        self.delay      = delay;
        self.loop       = loop;
        self.fork       = fork;
        self.spawn      = spawn;
        self.dynamic    = dynamic;
        self.track      = track;
        self.trackR     = trackR;
        self.fire       = fire;
        self.log        = log;
        self.anim       = anim;
        self.rate       = rate;

        return self;
    }

    /**
     * PeriodicTimer 
     *
     * A simple class with two methods - start() and stop().
     * The given callback is called periodically. I wrote
     * this class because setInterval() has **significantly* better
     * callback regularity than setTimeout in node.js. You can,
     * however, use this in a browser as well as in node.js as it
     * can check for a browser environment and adapt the precision
     * to the necessary level. Note that the *minimum* precision
     * in a browser environment will be that of requestAnimationFrame
     * if that API exists. Otherwise the callback will be called
     * at least once every 33 ms.
     *
     * Here are a couple of measurements (in ms) for N callbacks 
     * with dt interval for setInterval under node.js -
     *      {"N":1500,"dt":10,"mean":0.13,"min":-1,"max":1,"deviation":0.34}
     *      {"N":1500,"dt":10,"mean":-0.84,"min":-2,"max":0,"deviation":0.37}
     * Here are two measurements for setTimeout under node.js -
     *      {"N":1500,"dt":10,"mean":-850.31,"min":-1680,"max":-3,"deviation":486.16}
     *      {"N":1500,"dt":10,"mean":-833.59,"min":-1676,"max":0,"deviation":479.3}
     *
     * There is no such difference between the two in the browser, so
     * we always latch on to requestAnimationFrame if found. Here is 
     * a measurement of setInterval in the browser (Chrome) - 
     *      {"N":1500,"dt":10,"mean":-687.63,"min":-1381,"max":-1,"deviation":402.51}
     */

    function PeriodicTimer(callback, precision_ms) {
        var requestAnimationFrame = (window.requestAnimationFrame 
                || window.mozRequestAnimationFrame 
                || window.webkitRequestAnimationFrame 
                || window.msRequestAnimationFrame);

        var self = this;
        var running = false;
        var intervalID;

        if (precision_ms === undefined) {
            precision_ms = 15; // Default to about 60fps just like requestAnimationFrame.
        } else {
            // If we're in a browser environment, no point trying to use
            // setInterval based code because the performance is as bad
            // as with setTimeout anyway -
            //      {"N":1500,"dt":10,"mean":-687.63,"min":-1381,"max":-1,"deviation":402.51}
            precision_ms = Math.min(Math.max(window.document ? 15 : 1, precision_ms), 33);
        }

        if (requestAnimationFrame && precision_ms >= 12) {
            self.start = function () {
                if (!running) {
                    running = true;
                    requestAnimationFrame(function () {
                        if (running) {
                            callback();
                            requestAnimationFrame(arguments.callee);
                        }
                    });
                }
            };

            self.stop = function () {
                running = false;
            };
        } else {
            self.start = function () {
                if (!running) {
                    running = true;
                    intervalID = setInterval(callback, 1);
                }
            };

            self.stop = function () {
                if (running) {
                    running = false;
                    clearInterval(intervalID);
                    intervalID = undefined;
                }
            };
        }

        self.__defineGetter__('running', function () { return running; });
        self.__defineSetter__('running', function (state) {
            if (state) {
                self.start();
            } else {
                self.stop();
            }
            return running;
        });

        if (precision_ms <= 5) {
            console.error("WARNING: High precision timing used. May impact performance.");
        }

        return self;
    }

    // This is a timer class with the same interface as '.timer', but which uses
    // a JavaScriptNode to generate the callbacks.

    function preserveNode(node) {
        (window.JSNodeTimer_jsnodes || (window.JSNodeTimer_jsnodes = [])).push(node);
    }

    function JSNodeTimer(callback, precision_ms, audioContext) {
        if (audioContext) {
            var jsnode = audioContext.createJavaScriptNode(1024);
            jsnode.onaudioprocess = function (event) {
                callback(); // For the moment, no timing information within these.
            };

            var self = this;
            var running = false;

            preserveNode(jsnode);

            self.start = function () {
                if (!running) {
                    running = true;
                    jsnode.connect(audioContext.destination);
                }
            };
            self.stop = function () {
                if (running) {
                    jsnode.disconnect();
                    running = false;
                }
            };
            self.__defineGetter__('running', function () { return running; });
            self.__defineSetter__('running', function (val) {
                if (val) {
                    self.start();
                } else {
                    self.stop();
                }
                return running;
            });
            return self;
        } else {
            return PeriodicTimer.call(this, callback, precision_ms);
        }
    }

    /**
     * Clock
     *
     * A simple clock type that can keep track of absolute time
     * as well as a rate-integrated relative time.
     *
     * [t1,t2] is the absolute time interval,
     * [t1r,t2r] is the rate integrated time interval,
     * dt is the absolute time step for scheduler tick. 'dt' is
     * expected to remain a constant.
     *
     * The 'rate' property can be anything that supports
     * the 'valueOf()' protocol.
     */
    function Clock(t, tr, dt, rate) {
        this.dt = dt;
        this.t1 = t;
        this.t2 = t + dt;
        this.t1r = tr;
        this.t2r = tr + rate.valueOf() * dt;
        this.rate = rate;

        this.data = null; 
        // Arbitrary data slot for use by scheduler tasks.  Each "track"
        // inherits this "data" field from the track that spawned/forked it.
        // The field is copied via prototypal inheritance using
        // Object.create(), so each track can treat "data" as though it owns it
        // and add and change properties. However, note that the "virtual copy"
        // isn't a deep copy, so modifying an object held in the data object
        // (ex: data.arr[3]) is likely to affect all tracks that can access
        // that object. You can override how data is copied by overriding a
        // clock's copy() method.

        return this;
    }

    // A function for rounding time in seconds up to millisecond precision.
    function ms(t) {
        return Math.round(t * 1000) / 1000;
    }

    // Convenience method to show the state of a clock object.
    Clock.prototype.toString = function () {
        return JSON.stringify([this.t1r, this.t2r - this.t1r, this.t1, this.t2 - this.t1].map(ms));
    };

    // Makes a copy such that the absolute and rate-integrated
    // times both match and the "data" field is "inherited".
    Clock.prototype.copy = function () {
        var c = new Clock(this.t1, this.t1r, this.dt, this.rate);
        if (this.data) {
            c.data = Object.create(this.data);
        }
        return c;
    };

    // Advances the absolute time interval by dt and the rate-integrated
    // one by dt * rate.
    Clock.prototype.advance = function (dt) {
        var dtr = dt * this.rate.valueOf();
        this.t1 += dt;
        this.t2 += dt;
        this.t1r += dtr;
        this.t2r += dtr;
        return this;
    };

    // Makes one scheduler time step. This just means that t1 takes
    // on the value of t2 and t2 correspondingly increments by a
    // tick interval. Similarly for the rate-integrated interval.
    Clock.prototype.tick = function () {
        this.t1 = this.t2;
        this.t2 += this.dt;
        this.t1r = this.t2r;
        this.t2r += this.dt * this.rate.valueOf();
        return this;
    };

    // Jumps the absolute time to the given time and adjusts
    // the rate-integrated value according to the jump difference.
    Clock.prototype.jumpTo = function (t) {
        var step_dt = t - this.t1;
        var step_dtr = step_dt * this.rate.valueOf();
        this.t1 += step_dt;
        this.t2 += step_dt;
        this.t1r += step_dtr;
        this.t2r += step_dtr;
        return this;
    };

    // Nudges the rate-integrated "relative" time to the given value.
    // The absolute start time is also adjusted proportionally.
    //
    // WARNING: This needs t2r > t1r to hold.
    Clock.prototype.nudgeToRel = function (tr) {
        tr = Math.max(this.t1r, tr);
        if (this.t2r > this.t1r) {
            this.t1 += (tr - this.t1r) * (this.t2 - this.t1) / (this.t2r - this.t1r);
        }
        this.t1r = tr;
        return this;
    };

    // Relative time to absolute time.
    Clock.prototype.rel2abs = function (rel) {
        return this.t1 + (rel - this.t1r) / this.rate.valueOf();
    };

    // Absolute time to relative time.
    Clock.prototype.abs2rel = function (abs) {
        return this.t1r + (abs - this.t1) * this.rate.valueOf();
    };

    namespace.SoundModel    = SoundModel;
    namespace.GraphNode     = GraphNode;
    namespace.Parameterize  = Parameterize;
    namespace.Scheduler     = Scheduler;
    namespace.Clock         = Clock;
    namespace.PeriodicTimer = PeriodicTimer;
    namespace.JSNodeTimer   = JSNodeTimer;

    return namespace;
}(window, org.anclab.steller));