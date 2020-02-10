var mongo = require('mongodb');
var check = require('validator').check;
var _ = require('underscore');
var emailjs = require('emailjs');
var fileService = require('./upload.js');
 
var emailServer  = emailjs.server.connect({
   user:    "supportemail@domain.com", 
   password:"supportpwd", 
   host:    "smtp.gmail.com", 
   ssl:     true
});

exports.loadStudy = function(req, res) {
    var token = req.params.token;
    console.log('Retrieving study by token: ' + token);


    DB.getClient().then(function(client)
	{
		let db = client.db('site');

        db.collection('studies', function(err, collection) {
            collection.findOne({'token':token}, function(err, item) {
                res.send(item);
            });
        });

        client.close();
    });
};

exports.openStudy = function(req, res) {
    var token = req.body.token;

    DB.getClient().then(function(client)
	{
		let db = client.db('site');
        db.collection('studies', function(err, collection) {
            collection.findOne({'token':token}, function(err, study) {
                collection.update( {'_id' : study._id}, 
                        {'$set' : {'status' : 'open'}});
                res.send({status:'ok'});
            });
            client.close();
        });
    });
}

exports.closeStudy = function(req, res) {
    var token = req.body.token;

    DB.getClient().then(function(client)
	{
		let db = client.db('site');

        db.collection('studies', function(err, collection) {
            collection.findOne({'token':token}, function(err, study) {
                collection.update( {'_id' : study._id}, 
                        {'$set' : {'status' : 'closed'}});
                res.send({status:'ok'});
                client.close();
            });
        });
    });
}

exports.download = function(req, res ) {
    var token = req.params.token;
    console.log(token);

    DB.getClient().then(function(client)
	{
		let db = client.db('site');

        // get surveyId, then votes matching that.
        db.collection('studies', function(err, studyCollection) {
            studyCollection.findOne({'token':token}, function(err, study) 
            {
                if( study && study.studyKind == "survey" )
                {
                    db.collection('votes', function(err, voteCollection) {
                        //voteCollection.find({'survey.$id':survey._id}).toArray(function(err, items) {
                        voteCollection.find({'studyId':study._id}).toArray(function(err, items) {
                            console.log(err || "Participants: " + items.length);

                            for( var i=0; i < items.length; i++ )
                            {
                                delete items[i]['email'];
                            }

                            res.setHeader('Content-disposition', 'attachment; filename=download.json');
                            res.send({votes: items});
                            client.close();
                        });
                    });
                }
                else if( study && study.studyKind == "dataStudy" )
                {
                    db.collection('votes', function(err, voteCollection) {
                        voteCollection.find({'studyId':study._id}).toArray(function(err, items) {

                            var fileIds = items.map( function(elem)
                                { 
                                    if( elem.files && elem.files.length > 0 )
                                        return elem.files[0].fileId;
                                    else
                                        return null; 
                                }).filter( function(elem){ return elem != null; });

                            console.log( fileIds );

                            // This creates the archive and attaches files to it.
                            fileService.readFiles( res, fileIds, function(err, archive)
                            {
                                for( var i=0; i < items.length; i++ )
                                {
                                    delete items[i]['email'];
                                }

                                var data = JSON.stringify( items, null, 3 );
                                // Add non-file data.
                                archive.append( data, { name: "data.json" }, function()
                                {
                                    console.log("appended: data");
                                });

                                // Signal that archive is done.
                                archive.finalize(function(err, written) 
                                {
                                    if (err) { throw err; }
                                    console.log(written + ' total bytes written');
                                    client.close();
                                });
                            });

                        });
                    });                
                }
                else
                {
                    res.send({error: "Could not find survey associated with provided token: " + token});
                    client.close();
                }
            });
        });
    });
}

// TODO: May consider abstracting out winner part into own routes.

exports.assignWinner = function(req, res ) {
    var token = req.params.token;
    console.log(token);

    DB.getClient().then(function(client)
	{
		let db = client.db('site');

        // get surveyId, then votes matching that.
        db.collection('studies', function(err, studyCollection) {
            studyCollection.findOne({'token':token}, function(err, study) 
            {
                if( study )
                {
                    db.collection('votes', function(err, voteCollection) {
                        voteCollection.find({'studyId': study._id }).toArray(function(err, items) 
                        {
                            console.log(err);

                            var pool = _.uniq(items, function(item,key,a) {
                                    return item.email;
                                }).filter( function(element, index, array) 
                                {
                                    try
                                    {
                                        return element.email && check(element.email).isEmail();
                                    }
                                    catch(ex)
                                    {
                                        return false;
                                    }
                                });

                            if (pool && pool.length > 0 )
                            {
                                // pick random...other fun ways?
                                var winner = pool[Math.floor(Math.random()*pool.length)];
                                res.send({'winner': winner.email});
                            }
                            else
                            {
                                res.send({'winner': 'Error: No valid emails'});
                            }
                            client.close();

                        });
                    });
                }
            });
        });
    });
};

// TODO: use token of some sort instead of email.
exports.notifyParticipant = function(req, res) {
    var email = req.body.email;
    var kind = req.body.kind;

    var redeem = "The researcher will follow up with more instructions on how to receive your compensation.";
    if( kind == "AMZN" )
    {
        redeem = "Your amazon gift card will be sent directly from amazon.com.";
    }
    else if( kind == "SURFACE" )
    {
        redeem = "Your Microsoft surface will be sent as soon as you reply back with your shipping address.";
    }
    else if( kind == "IPADMINI" )
    {
        redeem = "Your iPad Mini will be sent as soon as you reply back with your shipping address.";
    }
    else if( kind == "GITHUB" )
    {
        redeem = "Your github swag will be sent as soon as you reply back with your shipping address.";
    }
    else if( kind == "BROWSERSTACK" )
    {
        redeem = "Your browserstack token will be in another email.";
        // TODO include in ...
    }

    var msg = {
            text: "Thank you for participating in our research study.\n" +
                  redeem + "\n"
            , 
            from:    "<support@checkbox.io>",
            to:      "<"+ email +">",
            //to: "<cscorley@gmail.com>",
            //cc:      "else <else@gmail.com>",
            subject: "checkbox.io: study winner"
        };

    emailServer.send(msg, 
        function(err, message) 
        { 
            console.log(err || message);
            if( err )
            {
                res.send( {error: err } );
            }
            else
            {
                res.send( {message: message} );
            }
        }
    );

}

