/***************************************************/
/* Comapi Chat APi to Meya.ai bot adaptor example. */
/* Author: Dave Baddeley                           */
/***************************************************/
var express = require("express");
var router = express.Router();
var cryptoJS = require("crypto-js");
var util = require("util");
var request = require("request");
var stringify = require('json-stable-stringify');
var mimeTypes = require("mime-types");

// Enter your Meya webhook key here
const _meyaKey = "YOUR MEYA WEBHOOK KEY";

// Enter your Comapi API Space Id here e.g. 11164198-3f3f-4993-ab8f-70680c1113b1
const _yourComapiAPISpaceId = "YOUR_API_SPACE_ID";

// Enter your Comapi access token here
const _yourComapiAccessToken = "YOUR_ACCESS_TOKEN";

// Enter your Comapi webhook secret phrase
const _yourWebhookSecret = "YOUR COMAPI WEBHOOK SECRET";

///////////////////////////////////////
// GETs to easily check the page exists
router.get("/", function (req, res, next) {
  res.render("index", null);
});

router.get("/botInbound", function (req, res, next) {
  res.render("botInbound", null);
});

router.get("/botOutbound", function (req, res, next) {
  res.render("botOutbound", null);
});

////////////////////////////////////////////////////////////////////////////////
// Inbound handler will accept Comapi webhook events and convert to the bots API
router.post("/botInbound", function (req, res, next) {
  // Process data received from Comapi
  try {
    // Grab the body and parse to a JSON object
    if (req.body == null) {
      // No body, bad request.
      res.status(400).send("Bad request - No JSON body found!");
      return;
    }

    // We have a request body so lets look at what we have

    // First lets ensure it hasn"t been tampered with and it came from Comapi
    // We do this by checking the HMAC from the X-Comapi-Signature header
    let hmac = req.headers["x-comapi-signature"];

    if (hmac == null) {
      // No HMAC, invalid request.
      res.status(401).send("Invalid request: No HMAC value found!");
      return;
    } else {
      // Validate the HMAC, ensure you has exposed the rawBody, see app.js for how to do this
      let hash = cryptoJS.HmacSHA1(req.rawBody, _yourWebhookSecret);

      if (hmac != hash) {
        // The request is not from Comapi or has been tampered with
        res.status(401).send("Invalid request: HMAC hash check failed!");
        return;
      }
    }

    // All Ok
    var inboundEvent = req.body;

    // Log the event
    console.log("");
    console.log(util.format("Received a %s event id: %s", inboundEvent.name, inboundEvent.eventId));
    console.dir(inboundEvent, {
      depth: null,
      colors: true
    });

    // Is it an chatMessage.sent event heading out to the bot?
    if (inboundEvent.name === "chatMessage.sent" && inboundEvent.payload.context.direction === "inbound") {
      // Pass onto Meya
      let meyaReq = null;
      let meyaReqUrl = null;

      // Work through the message parts      
      if (inboundEvent.payload.parts) {
        inboundEvent.payload.parts.forEach(function (part, index) {

          // Setup Meya request
          meyaReq = {
            user_id: encodeUserId(inboundEvent),
            integration: "Webhook"
          };

          // Is it a plain text part?
          if (part.type.startsWith("text/")) {
            // Text based
            meyaReqUrl = "https://api.meya.ai/receive";
            meyaReq.text = part.data;
          } else {
            // Media based
            meyaReqUrl = "https://api.meya.ai/media";
            meyaReq.url = inboundEvent.payload.messageParts[0].url;

            // Is it an image?
            if (inboundEvent.payload.messageParts[0].type.startsWith("image/")) {
              // Send as image          
              meyaReq.type = "image";
            } else if (inboundEvent.payload.messageParts[0].type.startsWith("audio/")) {
              // Send as audio
              meyaReq.type = "audio";
            } else if (inboundEvent.payload.messageParts[0].type.startsWith("video/")) {
              // Send as audio
              meyaReq.type = "video";
            } else {
              // Send as file
              meyaReq.type = "file";
            }
          }

          // Log it
          console.log("");
          console.log(util.format("Calling Meya service %s with the user message:", meyaReqUrl));
          console.dir(meyaReq, {
            depth: null,
            colors: true
          });
          console.log("");

          // Send to Meya
          request({
            method: "POST",
            url: meyaReqUrl,
            auth: {
              "user": _meyaKey,
              "pass": ""
            },
            timeout: 130000,
            json: true,
            body: meyaReq
          }, function (error, response, body) {
            if (error || response.statusCode != 200) {
              // General error
              let msg = util.format("Call to Meya failed with HTTP status code %s and message: %s", response.statusCode, response.statusMessage);
              console.log(msg);
              console.dir(response.body, {
                depth: null,
                colors: true
              });

              res.status(500).send(msg);
            } else {
              // Call succeeded
              console.log("Call to Meya succeeded");

              // All good return a 200
              res.status(200).send();
            }
          });
        });
      }
    } else {
      // Not an inbound.
      console.log("Not a chatMessage.sent inbound event so ignoring!");
      res.status(200).send();
    }
  } catch (err) {
    // An error occurred
    let msg = "An error occurred receiving inbound bot messages, the error was: " + err;
    console.error(msg);
    res.status(500).send(msg);
  }
});

/////////////////////////////////////////////////////////
// Outbound messages, receive from bot and pass to Comapi
router.post("/botOutbound", function (req, res, next) {
  // Process data received from Comapi
  try {
    // Grab the body and parse to a JSON object
    if (req.body == null) {
      // No body, bad request.
      res.status(400).send("Bad request - No JSON body found!");
      return;
    }

    // We have a request body so lets look at what we have

    // First lets ensure it hasn't been tampered with and it came from Meya
    // We do this by checking the HMAC from the X-Meya-Signature header
    let hmac = req.headers["x-meya-signature"];

    if (hmac == null) {
      // No HMAC, invalid request.
      res.status(401).send("Invalid request: No HMAC value found!");
      return;
    } else {
      // Validate the HMAC, ensure you has exposed the rawBody, see app.js for how to do this
      let fullUrl = req.protocol + "://" + req.get("host") + req.originalUrl;
      console.log("Calculated URL for HMAC: " + fullUrl);
      let contentToValidate = fullUrl + orderedJsonStringify(req.body);
      let hash = cryptoJS.HmacSHA1(contentToValidate, _meyaKey);

      if (hmac != hash.toString(cryptoJS.enc.Base64)) {
        // The request is not from Comapi or has been tampered with
        res.status(401).send("Invalid request: HMAC hash check failed!");
        return;
      }
    }

    // Process the received event, remember you only have 3 secs to process
    let event = req.body;

    console.log("");
    console.log(util.format("Received a %s event", event.type));
    console.dir(event, {
      depth: null,
      colors: true
    });
    console.log("");

    // Sent from the bot or user, we only process bot events
    if (event.sender == "bot") {
      switch (event.type) {
        case "typing":
          sendTypingEventToComapi(event, res);
          break;
        case "text":
        case "card":
          sendMessageToComapiChat(event, res);
          break;
      }

      // All good return a 200
      res.status(200).send();
      return;

    } else {
      // Ignore event
      console.log("Not a outbound message from the bot, so ignoring!");
      res.status(200).send();
      return;
    }
  } catch (err) {
    // An error occurred
    let msg = "An error occurred receiving Outbound bot messages, the error was: " + err;
    console.error(msg);
    res.status(500).send(msg);
  }
});


// Help functions
/////////////////
function decodeUserId(event) {
  let elements = event.user_id.split("|");
  return {
    profileId: elements[0],
    chatId: elements[1]
  };
}

function encodeUserId(inboundEvent) {
  return (inboundEvent.payload.context.from.id + "|" + inboundEvent.payload.context.chatId);
}

function orderedJsonStringify(srcObject) {
  // Stringify and sort
  let result = stringify(srcObject);

  // Replace unicode characters with encoded versions
  result = result.replace(/[\u007F-\uFFFF]/g, function (chr) {
    return "\\u" + ("0000" + chr.charCodeAt(0).toString(16)).substr(-4);
  });

  return result;
}

function sendMessageToComapiChat(event, res) {
  // Split out the profile id and channel from the composite user id
  let userElements = decodeUserId(event);

  // Setup Comapi request JSON
  var myRequest = {
    from: {
      profileId: "ExampleBot",
      name: "Example bot"
    },
    parts: [],
    alert: {
      title: "Example bot",
      body: event.text
    },
    direction: "outbound",
    isAutomatedSend: true
  };

  // Is it a "text" type event from the bot?
  if (event.type == "text") {
    myRequest.body = event.text;
    myRequest.parts.push({
      name: "Text",
      type: "text/plain",
      data: event.text,
      size: event.text.length
    });
  }

  // Is it a "card" type event from the bot, yes so it is a media message.
  if (event.type == "card") {
    switch (event.card.type) {
      case "image":
        // Attach as multi part message
        let mimeType = mimeTypes.lookup(event.card.image_url);

        myRequest.parts.push({
          name: event.text,
          type: mimeType,
          url: event.card.image_url
        });

        myRequest.alert.body = "You have received a picture";
        break;
      case "text_buttons":
        // Render the options as suggestions after the message
        let msgPlusOptions = util.format("%s \n\nReply with one of: \n", event.card.text);

        event.card.buttons.forEach(function (button) {
          msgPlusOptions += util.format("\"%s\" \n", button.action);
        });

        myRequest.body = msgPlusOptions;
        myRequest.parts.push({
          name: "Text",
          type: "text/plain",
          data: msgPlusOptions,
          size: msgPlusOptions.length
        });
        break;
      default:
        // Unsupported card type
        console.log("Unsupported Meya card type, so ignoring: " + event.card.type);
        res.status(200).send("Unsupported Meya card type, so ignoring: " + event.card.type);
        return;
    }
  }

  // Log out the JSON request
  console.log("");
  console.log("Calling Comapi with the bot message:");
  console.dir(myRequest, {
    depth: null,
    colors: true
  });

  // Send on to Comapi
  request({
    method: "POST",
    url: util.format("https://api.comapi.com/apispaces/%s/chats/%s/messages", _yourComapiAPISpaceId, userElements.chatId),
    headers: {
      "cache-control": "no-cache",
      "content-type": "application/json",
      "accept": "application/json",
      authorization: "Bearer " + _yourComapiAccessToken
    },
    timeout: 130000,
    json: true,
    body: myRequest
  }, function (error, response, body) {
    if (error || !(response.statusCode == 200 || response.statusCode == 201)) {
      // General error
      let msg = util.format("Call to Comapi Chat API failed with HTTP status code %s and message: %s", response.statusCode, response.statusMessage);
      console.log(msg);
      console.dir(response.body, {
        depth: null,
        colors: true
      });

      res.status(500).send(msg);
    } else {
      // Call succeeded
      console.log("Call to Comapi succeeded");
    }
  });
}

function sendTypingEventToComapi(event, res) {
  // Split out the profile id and channel from the composite user id
  let userElements = decodeUserId(event);

  // Calculate RESTful URL
  let url = util.format("https://api.comapi.com/apispaces/%s/chats/%s/typing", _yourComapiAPISpaceId, userElements.chatId);

  // Log out the request
  console.log("");
  console.log(util.format("Calling Comapi with a typing %s request to %s", url, event.status));
  console.log("");

  // Send on to Comapi
  request({
    method: (event.status === "on" ? "POST" : "DELETE"), // Switch HTTP verb depending to indicate typing on or off
    url: url,
    headers: {
      "cache-control": "no-cache",
      authorization: "Bearer " + _yourComapiAccessToken
    },
    timeout: 130000,
    json: false,
    body: ""
  }, function (error, response, body) {
    if (error || response.statusCode != 204) {
      // General error
      let msg = util.format("Call to Comapi Chat API failed with HTTP status code %s and message: %s", response.statusCode, response.statusMessage);
      console.log(msg);
      console.dir(response.body, {
        depth: null,
        colors: true
      });

      res.status(500).send(msg);
    } else {
      // Call succeeded
      console.log("Call to Comapi succeeded");
    }
  });
}

// Export the module
////////////////////
module.exports = router;