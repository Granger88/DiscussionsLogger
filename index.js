const https = require('https');
const fs = require('fs');
const EventEmitter = require('events').EventEmitter
// Function to know if a string is JSON
var isJSON = function(json) {
    try {
        JSON.parse(json);
        return true;
    } catch (e) {
        return false;
    }
};

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
            fs.writeFileSync('./recent-post.json', JSON.stringify([]));
        }
        if (!fs.existsSync('./replies.json')) {
            fs.writeFileSync('./replies.json', JSON.stringify([]));
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
            var getId = this.https.get(`https://${this.server}.fandom.com/api.php?action=query&format=json&meta=siteinfo&siprop=wikidesc`, (res) => {
                var str = '';
                res.on('data', (data) => {
                    str += data.toString();
                });
                res.on('end', () => {
                    if (!isJSON(str)) {
                        reject('Invalid JSON detected: Cannot get wiki ID.');
                    } else {
                        var data = JSON.parse(str);
                        resolve(data.query.wikidesc.id);
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
    /**
     * @description Initializes the interval that checks for updates.
     * @ignore Do not call this function! Doing so can cause the Webhook to post the same message twice on updates!
     */
    init() {
        this.getWikiId().then((wikiId) => {
            setInterval(() => {
                var getPosts = this.https.get(`https://services.fandom.com/discussion/${wikiId}/threads/`, (res) => {
                    var str = '';
                    res.on('data', (data) => {
                        str += data.toString();
                    });
                    res.on('end', () => {
                        if (isJSON(str)) {
                            var data = JSON.parse(str)._embedded.threads[0]
                            var posts = JSON.parse(fs.readFileSync('./recent-post.json').toString());
                            if (posts.indexOf(data.id) == -1) {
                                if (this.eventNames().indexOf('newPost') != -1) { // Allowing clients to bind their own update event. [TODO]
                                    this.emit('newPost', data);
                                    posts.push(data.id);
                                    fs.writeFileSync('./recent-post.json', JSON.stringify(posts));
                                }
                                else {
                                    this.sendMessage(`[${data.createdBy.name}](https://${this.server}.fandom.com/wiki/User:${encodeURIComponent(data.createdBy.name)}) posted [${data.title}](<https://${this.server}.fandom.com/f/p/${data.id}>) in [${data.forumName}](https://${this.server}.fandom.com/f?catId=${data.forumId})`).then(() => {
                                        posts.push(data.id);
                                        fs.writeFileSync('./recent-post.json', JSON.stringify(posts));
                                    }).catch((err) => console.error(err));
                                }
                            } 
                        }
                    });
                });
                getPosts.on('error', (err) => console.error(err));
                // Replies
                var posts = JSON.parse(fs.readFileSync('./recent-post.json'));
                posts.forEach((postId) => {
                    var getReplies = this.https.get(`https://services.fandom.com/discussion/${wikiId}/threads/${postId}?responseGroup=full&show=all&limit=1`, (res) => {
                        var str = '';
                        res.on('data', (data) => {
                            str += data.toString();
                        });
                        res.on('end', () => {
                            if (isJSON(str)) {
                                var postData = JSON.parse(str);
                                var _embedded = postData._embedded
                                if (_embedded) {
                                    var reply = _embedded['doc:posts'];
                                    if (reply) {
                                        var replyData = reply[0];
                                        var replies = JSON.parse(fs.readFileSync('./replies.json').toString());
                                        if (replies.indexOf(replyData.id) == -1 && this.watching.indexOf(postId) == -1) {
                                            if (this.eventNames().indexOf('newReply') != -1) { // Allowing clients to bind their own update event. [TODO]
                                                this.emit('newReply', replyData);
                                                posts.push(replyData.id);
                                                fs.writeFileSync('./recent-post.json', JSON.stringify(posts));
                                            }
                                            else {
                                                this.sendMessage(`[${replyData.createdBy.name}](https://${this.server}.fandom.com/wiki/User:${encodeURIComponent(replyData.createdBy.name)}) posted a [reply](<https://${this.server}.fandom.com/f/p/${postData.id}/r/${replyData.id}>) to [${postData.title}](<https://${this.server}.fandom.com/f/p/${postData.id}>) in [${postData.forumName}](https://${this.server}.fandom.com/f?catId=${postData.forumId})`).then(() => {
                                                    replies.push(replyData.id)
                                                    fs.writeFileSync('./replies.json', JSON.stringify(replies));
                                                }).catch((err) => console.error(err));
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    });
                    getReplies.on('error', (err) => console.error(err));
                });
            }, 5000); // Checks for updates every 5 seconds
        }).catch((err) => console.error(err));
    }
    /**
     * @description Watches the post with the specified postId. Watching a post will not run the original update listener!
     * @param {string} postId The ID of the post to watch for replies.
     * @param {function} callback The function to run on a new reply.
     */
    watchPost(postId, callback) {
        this.getWikiId().then((wikiId) => {
            this.watching.push({postId});
            setInterval(() => {
                var watchRequest = this.https.get(`https://services.fandom.com/discussion/${wikiId}/threads/${postId}?responseGroup=full&show=all&limit=1`, (res) => {
                    var str = '';
                    res.on('data', (data) => {
                        str += data.toString();
                    });
                    res.on('end', () => {
                        if (isJSON(str)) {
                            var data = JSON.parse(str);
                            var watch = JSON.parse(fs.readFileSync('./replies.json').toString());
                            var _embedded = data._embedded;
                            if (_embedded) {
                                var reply = _embedded['doc:posts'];
                                if (reply) {
                                    var replyData = reply[0];
                                    if (watch.indexOf(replyData.id) == -1) {
                                        callback(replyData, data);
                                        watch.push(replyData.id);
                                        fs.writeFileSync('./replies.json', JSON.stringify(watch));
                                    }
                                }
                            }
                        }
                    });
                });
                watchRequest.on('error', (err) => console.error(err));
            }, 5000);
        }).catch((err) => console.error(err));
    }
}

module.exports = DiscussionsLogger
