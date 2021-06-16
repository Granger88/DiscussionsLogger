const https = require('https');
const fs = require('fs');
const EventEmitter = require('events').EventEmitter
const parser = require('')
// Function to know if a string is JSON
var isJSON = function(json) {
    try {
        JSON.parse(json);
        return true;
    } catch (e) {
        return false;
    }
};

function saveFile(fileName, contents) {
    console.log('Saving file', fileName);
    try {
        fs.writeFileSync(fileName, contents);
    } catch(e) {
        console.log('Error saving file:', e);
    }
}

function readFile(fileName) {
    try {
        var contents = fs.readFileSync(fileName);
        if (contents) {
            return contents.toString();
        }
    } catch (e) {
        console.log('Error reading file:', e, 'retrying...');
        return readFile(fileName);
    }
}


// Main class
class DiscussionsLogger extends EventEmitter {
    /**
     * @param {string} server The server to connect to for logging posts.
     * @param {string} id The ID for the logging Webhook.
     * @param {string} token The token for the logging Webhook
     */
    constructor(server, id, token) {
        super();
        if (!server) {
            this.emit('error', new Error('\'server\' parameter not supplied.'));
        }
        if (!id) {
            this.emit('error', new Error('\'id\' parameter not supplied.'));
        }
        if (!token) {
            this.emit('error', new Error('\'token\' parameter not supplied.'));
        }
        this.server = server;
        this.id = id;
        this.token = token;
        this.https = https;
        this.watching = [];
        // Check for log files
        if (!fs.existsSync('./recent-post.json')) {
            saveFile('./recent-post.json', JSON.stringify([]));
        }
        if (!fs.existsSync('./replies.json')) {
            saveFile('./replies.json', JSON.stringify([]));
        }
        // init
        this.init();
    }
    /**
     * @description Function that gets the ID of the wiki of DiscussionsLogger.server.
     * @ignore Do not call this function!
     */
    getWikiId() {
        return new Promise((resolve, reject) => {
            var getId = this.https.get(`https://${this.server}.fandom.com/api.php?action=query&format=json&meta=siteinfo&siprop=variables`, (res) => {
                var str = '';
                res.on('data', (data) => {
                    str += data.toString();
                });
                res.on('end', () => {
                    if (!isJSON(str)) {
                        reject('Invalid JSON detected: Cannot GET wiki ID.');
                    } else {
                        var data = JSON.parse(str);
                        for (var i of data.query.variables) {
                            if (i.id == 'wgCityId') {
                                resolve(i['*']);
                            }
                        }
                    }
                });
            });
            getId.on('error', () => reject('[HTTP Error] Cannot GET wiki ID.'));
        });
    }
    /**
     * @description Sends a message to the Webhook.
     * @returns {promise} Promise rejects unsuccessful requests to the webhook.
     * @param {string} content The message to send to the webhook.
     */
    sendMessage(content) {
        return new Promise((resolve, reject) => {
            if (!content || typeof(content) != 'string') {
                reject('Cannot send an empty message');
            } else {
                var sendMessageRequest = this.https.request({
                    host: 'discordapp.com',
                    path: `/api/webhooks/${this.id}/${this.token}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }, () => {
                    resolve();
                });
                sendMessageRequest.write(JSON.stringify({
                    content: content
                }));
                sendMessageRequest.end();
                sendMessageRequest.on('error', (err) => {
                    reject(err);
                });
            }
        });
    }
    sendMessageWithParams(params) {
        return new Promise((resolve, reject) => {
            if (!params || typeof(params) != 'object') {
                reject('Cannot send an empty message');
            } else {
                var sendMessageRequest = this.https.request({
                    host: 'discordapp.com',
                    path: `/api/webhooks/${this.id}/${this.token}`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }, () => {
                    console.log('Success!');
                    resolve();
                });
                sendMessageRequest.write(JSON.stringify(params));
                sendMessageRequest.end();
                sendMessageRequest.on('error', (err) => {
                    console.log('Error:', err);
                    reject(err);
                });
            }
        });
    }
    /**
     * @description Initializes the interval that checks for updates.
     * @ignore Do not call this function! Doing so can cause the Webhook to post the same message twice on updates!
     */
    init() {
        setInterval(() => {
            var getPosts = this.https.get(`https://${this.server}.fandom.com/wikia.php?controller=DiscussionThread&method=getThreads&limit=1&containerType=FORUM`, (res) => {
                var str = '';
                res.on('data', (data) => {
                    str += data.toString();
                });
                res.on('end', () => {
                    if (isJSON(str)) {
                        try {
                            var data = JSON.parse(str)._embedded.threads[0];
                            var posts = JSON.parse(readFile('./recent-post.json').toString());
                            if (posts.indexOf(data.id) == -1) {
                                if (this.eventNames().indexOf('newPost') != -1) { // Allowing clients to bind their own update event. [TODO]
                                    this.emit('newPost', data);
                                    posts.push(data.id);
                                    saveFile('./recent-post.json', JSON.stringify(posts));
                                }
                                else {
                                    posts.push(data.id);
                                    saveFile('./recent-post.json', JSON.stringify(posts));
                                    if (JSON.parse(readFile('./recent-post.json').toString()).indexOf(data.id) != -1) { // Make absolutely sure the post is in the array before sending.
                                        var body = data.rawContent;
                                        if (body.length > 256) {
                                            body = body.substring(0, 253) + '...';
                                        }
                                        this.sendMessageWithParams({
                                            embeds: [
                                                {
                                                    description: `[${data.createdBy.name}](https://${this.server}.fandom.com/wiki/User:${encodeURIComponent(data.createdBy.name)}) posted [${data.title}](<https://${this.server}.fandom.com/f/p/${data.id}>) in [${data.forumName}](<https://${this.server}.fandom.com/f?catId=${data.forumId}>)`,
                                                    author: {
                                                        icon_url: data.createdBy.avatarUrl || 'https://vignette.wikia.nocookie.net/messaging/images/1/19/Avatar.jpg/revision/latest/scale-to-width-down/150',
                                                        name: data.createdBy.name
                                                    },
                                                    footer: {
                                                        text: body,
                                                    },
                                                    color: 26367
                                                }
                                            ]
                                        }).catch((err) => console.error(err));
                                    }
                                }
                            } 
                        } catch (e) {
                            console.log('Error while trying to send post:', e);
                        }
                    }
                });
            });
            // Replies
            var getReplies = this.https.get(`https://${this.server}.fandom.com/wikia.php?controller=DiscussionPost&method=getPosts&limit=1&containerType=FORUM`, (res) => {
                var str = '';
                res.on('data', (data) => {
                    str += data.toString();
                });
                res.on('end', () => {
                    if (isJSON(str)) {
                        try {
                            var data = JSON.parse(str)._embedded['doc:posts'][0];
                            var replies = JSON.parse(readFile('./replies.json').toString());
                            if (data.isReply && replies.indexOf(data.id) == -1) {
                                var parent = data._embedded.thread[0];
                                if (this.eventNames().indexOf('newPost') != -1) { // Allowing clients to bind their own update event. [TODO]
                                    this.emit('newPost', data);
                                    replies.push(data.id);
                                    saveFile('./replies.json', JSON.stringify(replies));
                                }
                                else {
                                    replies.push(data.id);
                                    saveFile('./replies.json', JSON.stringify(replies));
                                    if (JSON.parse(readFile('./replies.json').toString()).indexOf(data.id) != -1) { // Make absolutely sure the post is in the array before sending.
                                        var body = data.rawContent;
                                        if (body.length > 256) {
                                            body = body.substring(0, 253) + '...';
                                        }
                                        this.sendMessageWithParams({
                                            embeds: [
                                                {
                                                    description: `[${data.createdBy.name}](https://${this.server}.fandom.com/wiki/User:${encodeURIComponent(data.createdBy.name)}) posted a [reply](https://${this.server}.fandom.com/f/p/${parent.firstPost.threadId}/r/${data.id}) to [${parent.title}](<https://${this.server}.fandom.com/f/p/${parent.firstPost.threadId}>) in [${data.forumName}](<https://${this.server}.fandom.com/f?catId=${data.forumId}>)`,
                                                    author: {
                                                        icon_url: data.createdBy.avatarUrl || 'https://vignette.wikia.nocookie.net/messaging/images/1/19/Avatar.jpg/revision/latest/scale-to-width-down/150',
                                                        name: data.createdBy.name
                                                    },
                                                    footer: {
                                                        text: body,
                                                    },
                                                    color: 65280
                                                }
                                            ]
                                        }).catch((err) => console.error(err));
                                    }
                                }
                            } 
                        } catch (e) {
                            console.log('Error while trying to send post:', e);
                        }
                    }
                });
            });
        }, 5000); // Checks for updates every 5 seconds
    }
    /**
     * @description Watches the post with the specified postId. Watching a post will not run the original update listener!
     * @param {string} postId The ID of the post to watch for replies.
     * @param {function} callback The function to run on a new reply.
     */
    watchPost(postId, callback) {
        this.getWikiId().then((wikiId) => {
            this.watching.push(postId);
            setInterval(() => {
                var watchRequest = this.https.get(`https://services.fandom.com/discussion/${wikiId}/threads/${postId}?responseGroup=full&show=all&limit=1`, (res) => {
                    var str = '';
                    res.on('data', (data) => {
                        str += data.toString();
                    });
                    res.on('end', () => {
                        if (isJSON(str)) {
                            try {
                                var data = JSON.parse(str);
                                var watch = JSON.parse(readFile('./replies.json').toString());
                                var _embedded = data._embedded;
                                if (_embedded) {
                                    var reply = _embedded['doc:posts'];
                                    if (reply) {
                                        var replyData = reply[0];
                                        if (watch.indexOf(replyData.id) == -1) {
                                            callback(replyData, data);
                                            watch.push(replyData.id);
                                            saveFile('./replies.json', JSON.stringify(watch));
                                        }
                                    }
                                }
                            } catch(e) {
                                console.log('Error with watching post:', e);
                            }
                        }
                    });
                });
                watchRequest.on('error', (err) => console.error(err));
            }, 5000);
        }).catch((err) => console.error(err));
    }
}

module.exports = DiscussionsLogger;