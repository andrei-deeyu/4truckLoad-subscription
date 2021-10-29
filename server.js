const express = require('express');
const app = express();

// Load config
require('dotenv').config({ path: '.env' })

const fetch = require('node-fetch');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const AuthenticationClient = require('auth0').AuthenticationClient;

var auth0 = new AuthenticationClient({
  domain: 'dev-h1e424j0.us.auth0.com',
  clientId: '0ykKewQDNvLkYvJrxTMrOWG6IlUJtCxy',
  clientSecret: process.env.AUTH0_CLIENTSECRET
});

app.use(express.static(process.env.STATIC_DIR));
app.use(express.urlencoded());
app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function (req, res, buf) {
      if (req.originalUrl.startsWith('/webhook')) {
        req.rawBody = buf.toString();
      }
    },
  })
);

function respondError500(res, next) {
  res.status(500);
  const error = new Error('Unable to load');
  next(error);
}


app.post('/create-checkout-session/:email/:planName', async (req, res) => {
  let price;
  console.log(req.params)
  if( req.params.planName == 'transportator' ) price = 'price_1JpsL2Hywyy3Or57JsCkmptK';
  else if (req.params.planName == 'complet' ) price = 'price_1JpsLRHywyy3Or57kkzlqZIU';
  else return;

  const session = await stripe.checkout.sessions.create({
    customer_email: req.params.email,
    payment_method_types: [
      'card',
    ],
    line_items: [
      {
        // TODO: replace this with the `price` of the product you want to sell
        price: price,
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `https://4truckload.com/company/planchanged`,
    cancel_url: `https://4truckload.com/profile`,
  });

  res.redirect(303, session.url)
});


async function assignSubscription(email, paymentDescription, userID) {
  auth0.clientCredentialsGrant({ audience: 'https://dev-h1e424j0.us.auth0.com/api/v2/'}, async (err, response) => {
    if (err) return respondError500(res, next);

    /* get user ID by email */
      await fetch('https://dev-h1e424j0.us.auth0.com/api/v2/users?q=email:' + email, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${response.access_token}`
        },
      })
      .then(( res ) => res.json() )
      .then(response => userID = response[0].user_id);


    // insert { plan: type } to app_metadata in Auth0's Database
      await fetch('https://dev-h1e424j0.us.auth0.com/api/v2/users/' + userID, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${response.access_token}`
        },
        body: JSON.stringify({ "app_metadata": { "subscription": paymentDescription.toLowerCase() } })
      })
      .then(( res ) => res.json() )
      .then(( response ) => {
        console.log(response);
        console.log('done motherfucker sergiule')
        // make the client renew accessToken silently, by calling /loginWithRedirect(prompt=none)
        // this will avoid transferring the token over HTTPS, avoid CSFR attack, thus reducing the risk overall by enducing itself
        if( response ) { // is equally to ..
          return response.json({"wtf": "who reads it? stripe servers?"})
        }

      })
  });
}



  // Webhook handler for asynchronous events.
  app.post('/webhook', async (req, res) => {
    let event;

    // Check if webhook signing is configured.
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      // Retrieve the event by verifying the signature using the raw body and secret.
      let signature = req.headers['stripe-signature'];

      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (error) {
        console.log(`⚠️  Webhook signature verification failed.`);
        return res.sendStatus(400);
      }
    } else {
      // Webhook signing is recommended, but if the secret is not configured in `.env`,
      // retrieve the event data directly from the request body.
      event = req.body;
    }

    if (event.type == 'checkout.session.completed') {
      console.log(`🔔  Payment received!`);
      console.log(event)
      const session = event.data.object;

      const { line_items } = await stripe.checkout.sessions.retrieve(
        session.id,
        {
          expand: ["line_items"],
        }
      );

      if(event.data.object.payment_status == 'paid') {
        console.log('aci e bun zero')
        let email = event.data.object.customer_details.email; // the one from Stripe payment

        await assignSubscription(email, line_items.data[0].description);
      }

    } else {
      console.log(event.type)
    }

    res.sendStatus(200);
  });





function notFound(req, res, next) {
  res.status(404);
  const error = new Error('Not Found - ' + req.originalUrl);
  next(error);
}

function errorHandler(err, req, res, next) {
  res.status(res.statusCode || 500);
  res.json({
    message: err.message,
    stack: err.stack
  });
}

app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 4242;
app.listen(port, () => {
  console.log('Listening on port', port);
});