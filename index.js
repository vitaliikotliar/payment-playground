require('dotenv').config();
const express = require('express');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const cors = require('cors');
const app = express();
const port = 8000;

app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
	res.status(200).send('Pong!')
})

/**
 * STRIPE
 */

// Fetch line items (subscriptions) from Stripe
app.get('/api/line-items', async (req, res) => {
	try {
		const prices = await stripe.prices.list();
		const lineItems = await Promise.all(prices.data.map(async (price) => {
			const product = await stripe.products.retrieve(price.product);  // Fetch the product details using the product ID

			return {
				id: price.id,
				name: product.name,
				description: product.description,
				amount: price.unit_amount / 100,
				currency: price.currency,
			};
		}));
		res.json(lineItems);
	} catch (error) {
		res.status(500).send(error.message);
	}
});

// Create checkout session
app.post('/api/create-checkout-session', async (req, res) => {
	const { priceId } = req.body;

	const redirect_url = new URL(req.headers.origin)
	redirect_url.searchParams.append('plusSubscribed', true)

	try {
		const session = await stripe.checkout.sessions.create({
			ui_mode: 'custom',
			payment_method_types: ['card', 'paypal'],
			line_items: [{ price: priceId, quantity: 1 }],
			mode: 'subscription',
			return_url: redirect_url,
		});

		res.json({ checkoutSessionClientSecret: session.client_secret });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// Create Stripe subscription
app.post('/api/subscriptions', async (req, res) => {
	const { email, priceId } = req.body;

	try {
		const customer = await stripe.customers.create({
			email: email,
			payment_method: 'pm_card_visa', // Or collect it via Stripe Elements
			invoice_settings: {
				default_payment_method: 'pm_card_visa',
			},
		});

		const subscription = await stripe.subscriptions.create({
			customer: customer.id,
			items: [{price: priceId}], // Price ID from your Stripe dashboard
			payment_behavior: 'default_incomplete',
			expand: ['latest_invoice.confirmation_secret']
		});

		const clientSecret = subscription.latest_invoice.confirmation_secret.client_secret;

		res.json({ clientSecret });
	} catch (e) {
		res.status(500).send(e.message);
	}
})

// Create payment intent for selected line item
app.post('/api/create-payment-intent', async (req, res) => {
	const { priceId } = req.body; // Price ID for the selected line item

	try {
		const price = await stripe.prices.retrieve(priceId);
		const paymentIntent = await stripe.paymentIntents.create({
			amount: price.unit_amount,
			currency: price.currency,
			description: 'IGN Plus',
			metadata: { priceId },
		});
		res.json({ clientSecret: paymentIntent.client_secret });
	} catch (error) {
		res.status(500).send(error.message);
	}
});

// get customer subscriptions by email
app.get('/api/customer-subscriptions', async (req, res) => {
	const { email } = req.query; // Customer email

	try {
		const customers = await stripe.customers.list({ email })
		const customer = customers?.data?.[0]

		if (!customer?.id) {
			res.status(404).send('No Customer Found');
		} else {
			const subscriptions = await stripe.subscriptions.list({ customer: customer.id, status: 'all' })
			res.json({ subscriptions: subscriptions?.data || [] });
		}
	} catch (error) {
		res.status(500).send(error.message);
	}
})

// cancel subscription
app.post('/api/subscriptions/cancel', async (req, res) => {
	const { id } = req.body; // Subscription id

	try {
		const subscription = await stripe.subscriptions.update(id, { cancel_at_period_end: true })

		res.json({ subscription })
	} catch (error) {
		console.error(error.message)
		res.status(500).send(error.message);
	}
})

// resume subscription
app.post('/api/subscriptions/resume', async (req, res) => {
	const { id } = req.body; // Subscription id

	try {
		const subscription = await stripe.subscriptions.update(id, { cancel_at_period_end: false })
		res.json({ subscription })
	} catch (error) {
		console.error(error.message)
		res.status(500).send(error.message);
	}
})

// get user payment methods
app.get('/api/user-payment', async (req, res) => {
	const { email } = req.query;

	if (!email) {
		return res.status(400).send('Email is required')
	}

	try {
		const customers = await stripe.customers.list({ email, limit: 1 })
		const customer = customers?.data?.[0]

		if (!customer) {
			res.status(404).send('No Customer Found');
		} else {
			const paymentMethods = await stripe.paymentMethods.list({
				customer: customer.id,
				type: 'card'
			})
			res.json({ paymentMethods })
		}
	} catch (e) {
		res.status(500).send(e.message);
	}
})

// get user events (history)
app.get('/api/history', async (req, res) => {
	const { subscription_id } = req.query;

	if (!subscription_id) {
		return res.status(400).send('Subscription ID is required')
	}

	try {
		const events = await stripe.events.list({ related_object: subscription_id, limit: 50 })

		res.json({ events })
	} catch (e) {
		res.status(500).send(e.message);
	}
})

// Paypal
app.get('/api/subscription', async (req, res) => {
	try {
		const response = await axios.get('https://api.sandbox.paypal.com/v1/billing/subscriptions/I-LC5CSKKFNP2E', {
			headers: {
				'Authorization': `Bearer ${process.env.PAYPAL_TOKEN}`, // Replace with your PayPal access token
			}
		});
		const links = response?.data?.links

		res.status(200).send({subscription: response.data})
	} catch (e) {
		res.status(500).send(e.message);
	}
})

// Endpoint to get PayPal subscription data
app.get('/api/paypal/subscription', async (req, res) => {
	try {
		// Example: Fetching plan data from PayPal
		const response = await axios.get('https://api.sandbox.paypal.com/v1/billing/plans', {
			headers: {
				'Authorization': `Bearer ${process.env.PAYPAL_TOKEN}`, // Replace with your PayPal access token
			}
		});

		res.json({ plans: response.data.plans }); // Return the plan ID (or other subscription data)
	} catch (error) {
		console.error('Error fetching subscription data from PayPal:', error);
		res.status(500).send('Error fetching subscription data');
	}
});

app.listen(port, () => {
	console.log(`Server is running at http://localhost:${port}`);
});
