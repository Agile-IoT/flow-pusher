var request=require('request');
var fs = require('fs');
var d = require('debug')('flow-pusher')

function prequest(url, options, transform) {

    return new Promise((resolve, reject) => {
        d(`request(${url}, ${JSON.stringify(options)})`);
        request(url, options, (err, res, body) => {
            if (!err && (res.statusCode < 200 || res.statusCode >= 300)) {
                method = options["method"] || "GET";
                err = new Error(
                    `Unexpected status code: ${res.statusCode} on ` +
                    `${method} ${url}. Body=${JSON.stringify(body)}`
                );
                err.res = res;
            }
            if (err) {
                d(`reject(${err})`);
                return reject(err);
            }
            d(`request(${url}. Output: ${JSON.stringify(body)}`);
            if (transform === undefined) {
                resolve(body);
            }
            else {
                resolve(transform(body));
            }
        });
    });
}


/*
 * Node-RED API abstraction for the secured Node-RED on AGILE.
 *
 * Parameters:
 * - baseurl: Node-RED instance address
 * - token: Node-RED token (as returned by authenticate())
 */
var NodeRedApi = (baseurl, token) => {

    function get_options(other) {
        var options = {
            headers: {
                "Accept": "application/json",
            },
            json: true
        };
        var result = Object.assign(options, other);   // Object.assign modifies "options"
        if (token !== undefined) {
            options.headers.Authorization = `Bearer ${token}`;
        }
        return result;
    }

    return {

        /*
         * Gets token for a secured Node-RED, authenticating using user and password.
         */
        authenticate: (user, password) => {
            var url = `${baseurl}/auth/token`;
            var data = `client_id=node-red-admin&grant_type=password&scope=*&username=${user}&password=${password}`;
            data = {
                "client_id" : "node-red-admin",
                "grant_type": "password",
                "scope": "*",
                "username": `${user}`,
                "password": `${password}`
            }
            return prequest(
                url,
                get_options({
                    "method": "POST",
                    "form": data,
                    "json": false,
                    "headers" : { "Content-type": "application/x-www-form-urlencoded"}
                }),
                (body) => {
                    var json = JSON.parse(body);
                    var token = json.access_token;
                    return token;
                }
            );
        },

        /*
         * Returns all deployed nodes (excluding configuration).
         * There is one node with type="tab" per flow.
         *
         * It is an array of nodes
         */
        fetchcurrentflows: () => {
            var url = `${baseurl}/flows`;
            return prequest(url, get_options());
        },

        /*
         * Returns nodes from flow with id "tab_id".
         *
         * It is an object with the following fields:
         * - id
         * - label
         * - nodes (array of nodes)
         */
        fetchflow: (tab_id) => {
            var url = `${baseurl}/flow/${tab_id}`;
            return prequest(url, get_options());
        },

        /*
         * Return global nodes (config nodes).
         *
         * It is an object with the following fields:
         * - id ( = global)
         * - configs (array of nodes)
         */
        fetchglobalflow: () => {
            var url = `${baseurl}/flow/global`;
            return prequest(url, get_options());
        },

        postflows: (flowtopush, deployment_type) => {
            var url = `${baseurl}/flows`;
            return prequest(
                url,
                get_options({
                    "method": "POST",
                    "json": flowtopush,
                    "headers":  {
                        "Node-RED-Deployment-Type" : deployment_type || "full"
                    }
                })
            );
        },

        postflow: (flowtopush) => {
            var url = `${baseurl}/flow`;
            return prequest(
                url,
                get_options({
                    "method": "POST",
                    "json": flowtopush,
                })
            );
        }
    }
}

/*
 * Util functions to work with Node-RED workflows.
 *
 * A workflow is the JSON deserialization of the result of calling the Node-RED API.
 */
var FlowUtils = () => {

    const Types = {
        TAB : "tab",
        UI_BASE : "ui_base",
        LINK_IN : "link in",
        LINK_OUT : "link out",
        HTTP_IN : "http in",
        HTTP_OUT : "http response",
        HTTP_REQUEST : "http request"
    };

    /*
     * Simple function to clone a structure of nodes.
     * (valid while there are not callables)
     */
    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }

    /*
     * The same ID-generation function nodered uses
     */
    function getID() {
        return (1+Math.random()*4294967295).toString(16);
    }

    function findnodes(nodesarray, matchfunction) {
        return nodesarray.filter(matchfunction);
    }

    function findnode(nodesarray, matchfunction) {
        return nodesarray.find(matchfunction);
    }

    function findtabnode(currentflows, sourcelabel) {

        var tabnode = findnode(
            currentflows,
            n => n.type === Types.TAB && n.label === sourcelabel
        );
        return tabnode;
    }

    function findnodesintab(tabflow_) {

        return findnodes(
            tabflow_.nodes,
            n => !n.type.startsWith("subflow")
        );
    }

    function findconfignodes(configtab) {

        var confignodes = findnodes(
            configtab.configs || [],
            n => n.type != Types.UI_BASE && n.type != "xively-config"
        );
        return confignodes;
    }

    function istype(node, type) {
        return node.type == type;
    }

    function isintab(node, tabnode) {
        return node.z != undefined && node.z == tabnode.id;
    }

    function islinkingto(node, to) {
        return node.links && node.links.length == 1 && node.links[0] == to.id;
    }

    function findlinkinnode(nodes) {
        var linkin_node = findnode(
            nodes, n => n.type == Types.LINK_IN
        );
        return linkin_node;
    }

    function convert_to_http_in(node, path) {

        node.type = Types.HTTP_IN;
        node.url = path;        // path is sth like "/somepath"
        node.method = "post";
    }

    function convert_to_http_request(node, remoteurl) {
        node.type = Types.HTTP_REQUEST;
        node.url = remoteurl;
        node.method = "POST";
    }

    function newnode(type, attrs) {
        n = {
            id : getID(),
            type : type
        }
        Object.assign(n, attrs);
        return n;
    }

    function linknodes(nodeout, nodein) {
        if (nodeout.wires.length == 0) {
            inner = [];
            nodeout.wires.push(inner);
        }
        else {
            inner = nodeout.wires[0];
        }
        inner.push(nodein.id);
    }

    return {
        Types : Types,
        clone : clone,
        findnode : findnode,
        findnodes : findnodes,
        findtabnode : findtabnode,
        findnodesintab : findnodesintab,
        findconfignodes : findconfignodes,
        findlinkinnode : findlinkinnode,
        convert_to_http_in : convert_to_http_in,
        convert_to_http_request : convert_to_http_request,
        linknodes : linknodes,
        newnode : newnode,
        istype : istype,
        isintab : isintab,
        islinkingto : islinkingto
    }
}

/*
 * Performs an upload of a tab in a workflow on a source Node-RED instance to a target Node-RED instance.
 * The source is workflow is modified in such a way that the data entering to that tab is forwarded to
 * the remote instance.
 *
 * Parameters:
 * - sourceapi: NodeRedApi "object" of source Node-RED instance
 * - sourcelabel: label of tab to push to target Node-RED
 * - targeturl: NodeRedApi "object" of target Node-RED instance
 */
var FlowPusher = (sourceapi, sourcelabel, targetapi) => {

    const utils = FlowUtils();
    const Types = utils.Types;
    const clone = utils.clone;

    function build_path(node) {
        return `/${node.id}`
    }
    /*
     * Modify flow to push to remote, converting
     * link_in nodes into http_in nodes.
     */
    function modify_flowtopush(flow) {

        var linkin_nodes = utils.findnodes(
            flow, n => utils.istype(n, Types.LINK_IN));

        var httpout_nodes = linkin_nodes.forEach(linkin_node => {
            utils.convert_to_http_in(linkin_node, build_path(linkin_node));
            const httpin_node = linkin_node;
            var httpout_node = utils.newnode(
                utils.Types.HTTP_OUT,
                { x : httpin_node.x, y : httpin_node.y + 30, z : httpin_node.z }
            );
            utils.linknodes(httpin_node, httpout_node)
            flow.push(httpout_node);
        });
    }

    /*
     * Convert all link_out nodes to a tab into http_request nodes. Returns
     * the modified flows as a copy of the original flows.
     *
     * The function finds the link_in nodes to the tab, then finds the link_out
     * nodes to each link_in nodes, converting them to a proper http_request
     */
    function modify_link_out_nodes(currentnodes, tabnode) {
        var modifiednodes = clone(currentnodes);

        var linkin_nodes = utils.findnodes(
            modifiednodes,
            n => utils.istype(n, Types.LINK_IN) && utils.isintab(n, tabnode)
        );

        linkin_nodes.forEach(in_ => {
            const remoteurl = `${targeturl}${build_path(in_)}`;

            var linkout_nodes = utils.findnodes(
                modifiednodes,
                out => utils.istype(out, Types.LINK_OUT) &&
                       utils.islinkingto(out, in_));

            linkout_nodes.forEach( out => {
                utils.convert_to_http_request(out, remoteurl);
            });
        });
        return modifiednodes;
    }

    /*
     * Calculates nodeset1 - nodeset2
     * (i.e., each element in nodeset1 but not in nodeset2)
     */
    function difference(nodeset1, nodeset2) {
        nodemap2 = {};
        nodeset2.forEach(n => {
            nodemap2[n.id] = n;
        });
        var result = [];
        nodeset1.forEach(n => {
            if (nodemap2[n.id] === undefined) {
                result.push(n);
            }
        });
        return result;
    }

    return {
        pushflow: () => {

            /*
             * Implementation note: nodes must be cloned when is intended to be
             *  modified. Nodes are not being cloned by default.
             */
            var currentnodes;
            var tabflownodes;
            var tabnode;
            var confignodes;
            var localconfignodes;
            var modifiedflows;

            sourceapi.fetchcurrentflows()
            .then(currentflows => {
                currentnodes = currentflows;
                tabnode = utils.findtabnode(currentflows, sourcelabel);

                return sourceapi.fetchflow(tabnode["id"]);
            }).then(sourceflow => {
                tabflownodes = utils.findnodesintab(sourceflow);

                return sourceapi.fetchglobalflow();
            }).then(localglobalflow => {
                localconfignodes = utils.findconfignodes(localglobalflow);

                return targetapi.fetchcurrentflows();
            }).then(remotenodes => {

                confignodes = difference(localconfignodes, remotenodes || []);
                var flowtopush = {
                    "id": tabnode["id"],
                    "label": sourcelabel,
                    "nodes": tabflownodes,
                    "configs": confignodes
                }
                d(`configs: ${JSON.stringify(confignodes)}`)

                modify_flowtopush(flowtopush.nodes);
                modifiedflows = modify_link_out_nodes(currentnodes, tabnode);

                return targetapi.postflow(flowtopush);
            }).then(body => {

                return sourceapi.postflows(modifiedflows, "nodes");
            }).then(body => {

                /*  Does nothing */

            }).catch(err => {
                console.log(err.stack || err);
            });
        }
    };
};

function usage_and_exit() {
    console.log("Usage: flow-pusher -s <url> -t <url> -l <tab label>");
    process.exit(2);
}


if (process.argv.length == 1) {
    console.log("A");
    usage_and_exit();
}

currentswitch = "";
var sourceurl = ""; //"http://agile.local:1880/red";
var targeturl = ""; //"http://agile.remote:1880";
var label = "";
for (i = 1; i < process.argv.length; i++) {
    arg = process.argv[i];
    switch (currentswitch) {
        case "-s":
            sourceurl = arg;
            currentswitch = "";
            break;
        case "-t":
            targeturl = arg;
            currentswitch = "";
            break;
        case "-l":
            label = arg;
            currentswitch = "";
            break;
        default:
            if (currentswitch == "") {
                if (arg.startsWith("-")) {
                    currentswitch = arg;
                }
                else {
                    /* ignore */
                }
            }
            else {
                console.log("B");
                usage_and_exit();
            }
    }
}

console.log("sourceurl = " + sourceurl);
console.log("targeturl = " + targeturl);
console.log("label = " + label);

if (sourceurl == "" || targeturl == "" || label == "") {
    usage_and_exit();
}

var sourceapi = NodeRedApi(sourceurl);
var targetapi = NodeRedApi(targeturl);

if (false) {
    var pusher = FlowPusher(sourceapi, label, targetapi);
    pusher.pushflow();
}
else {
    sourceapi
        .authenticate("admin", "password")
        .then(token => {
            sourceapi = NodeRedApi(sourceurl, token);
            var targetapi = NodeRedApi(targeturl);
            var pusher = FlowPusher(sourceapi, label, targetapi);
            pusher.pushflow();
    });
}


module.exports = {
    FlowPusher : FlowPusher,
    FlowUtils: FlowUtils,
    NodeRedApi: NodeRedApi
}
