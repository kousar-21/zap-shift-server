const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 5000;




//stripe secret key
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

// Middleware
app.use(cors());
app.use(express.json());




const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster21kousar.ai36vz4.mongodb.net/?retryWrites=true&w=majority&appName=Cluster21kousar`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const parcelsCollections = client.db("parcelDb").collection("parcels");
    const usersCollection = client.db("parcelDb").collection("users");
    const paymentHistoryCollection = client.db("parcelDb").collection("paymentHistory");
    const trackingCollection = client.db("parcelDb").collection("tracking");
    const ridersCollection = client.db("parcelDb").collection("riders");

    //custom middleware for jwt token
    const verifiyFBToken = async (req, res, next) => {
      console.log('headers parts in middleware', req.headers)

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized Access" })
      }

      const token = authHeader.split(" ")[1]
      if (!token) {
        return res.status(401).send({ message: "Unauthorized Access" })
      }

      //verify firebase token
      try {
        const decodedFirebaseToken = await admin.auth().verifyIdToken(token);
        req.decoded = decodedFirebaseToken
      }
      catch (error) {
        return res.status(403).send({ message: "Access Forbidden For You" })
      }

      next()
    }

    //  custom middleware for verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Access Forbidden For You" })
      }

      next()
    }


    //seacrch funtionality for admin
    app.get("/users/search", async (req, res) => {
      const emailQuery = req.query.email;
      if (!emailQuery) {
        return res.status(400).send({ message: "Missing email query" });
      }

      const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match

      try {
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          // .project({ email: 1, createdAt: 1, role: 1 })
          .limit(10)
          .toArray();
        res.send(users);
      } catch (error) {
        console.error("Error searching users", error);
        res.status(500).send({ message: "Error searching users" });
      }
    });

    // GET: Get user role by email
    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        res.send({ role: user.role || 'user' });
      } catch (error) {
        console.error('Error getting user role:', error);
        res.status(500).send({ message: 'Failed to get role' });
      }
    });

    // this code for to make or remove one's as admin , verifyAdmin,
    app.patch("/users/:id/role", verifiyFBToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!["admin", "user"].includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send({ message: `User role updated to ${role}`, result });
      } catch (error) {
        console.error("Error updating user role", error);
        res.status(500).send({ message: "Failed to update user role" });
      }
    });

    //below line code (users collection) for user role
    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        //last login , updated data
        return res.status(200).send({ message: 'User already exists', inserted: false });
      }
      const newUser = req.body;
      const result = await usersCollection.insertOne(newUser);
      res.send(result)
    })

    //get specific or all email data from database
    app.get('/parcels', async (req, res) => {
      try {
        const { email, payment_Status, delivery_Status } = req.query;

        //jwt part
        console.log(req.headers)

        let query = {};
        if (email && email !== 'undefined') {
          query.created_By = email;
        }
        if (payment_Status) {
          query.payment_Status = payment_Status;
        }
        if (delivery_Status) {
          query.delivery_Status = delivery_Status;
        }

        //this is the more advanced part then above part
        // const query = req.query.email ? { created_By: req.query.email } : {};

        //this is more advanced
        const options = {
          sort: { creation_date: -1 },
        };

        //  console.log('assign rider part check', req.query, query)

        //this is more advanced 
        const result = await parcelsCollections.find(query, options).toArray();
        // console.log("result of get parcel", result.length)

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error fetching parcels' });
      }
    });

    //get parcel by id
    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await parcelsCollections.findOne(query);
      res.send(result);
    });


    //send every parcel data to database collection
    app.post("/parcels", async (req, res) => {
      const parcelData = req.body;

      const result = await parcelsCollections.insertOne(parcelData);
      res.send(result)
    })


    app.patch("/parcels/:id/assign", async (req, res) => {
      const parcelId = req.params.id;
      const { riderId, riderName } = req.body;

      try {
        // Update parcel
        await parcelsCollections.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              delivery_status: "in_transit",
              assigned_rider_id: riderId,
              assigned_rider_name: riderName,
            },
          }
        );
//this is new part
        // Update rider
        await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          {
            $set: {
              work_status: "in_delivery",
            },
          }
        );

        res.send({ message: "Rider assigned" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to assign rider" });
      }
    });


    //delete api from data base
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await parcelsCollections.deleteOne(query);
      res.send(result);
    });

    //rider related data

    app.post('/riders', async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    })


    app.get('/riders/pending', verifiyFBToken, verifyAdmin, async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: 'pending' }) // filter by status
          .toArray();

        res.send(pendingRiders); // no wrapper object, simple clean response
      } catch (err) {
        console.error('Error fetching pending riders:', err.message);
        res.status(500).send('Failed to load pending riders');
      }
    });


    // PATCH /riders/:id → update rider status
    app.patch('/riders/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { status, email } = req.body;
        // console.log(status,email)
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status,
            statusUpdatedAt: new Date(), // Optional: track status update time
          },
        }

        if (!['approved', 'cancelled', 'pending', 'active'].includes(status)) {
          return res.status(400).send({ error: 'Invalid status value' });
        }

        const result = await ridersCollection.updateOne(
          query,
          updatedDoc
        );

        //update user role for accepting rider
        if (status === "active") {
          const useQuery = { email }
          const userUpdateDoc = {
            $set: {
              role: "Rider"
            }
          }
          const roleResult = await usersCollection.updateOne(useQuery, userUpdateDoc)
          console.log(roleResult.modifiedCount)
        }


        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: 'Rider not found or status unchanged' });
        }

        res.send({ message: 'Rider status updated successfully' });
      } catch (error) {
        console.error('Error updating rider status:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // get rider data for assign rider modal or available part
    app.get("/riders/available", async (req, res) => {
      const { district } = req.query;

      try {
        const riders = await ridersCollection
          .find({
            district,
            // status: { $in: ["approved", "active"] },
            // work_status: "available",
          })
          .toArray();

        res.send(riders);
      } catch (err) {
        res.status(500).send({ message: "Failed to load riders" });
      }
    });

    // GET rider data from database, /riders?status=active
    app.get('/riders', verifiyFBToken, verifyAdmin, async (req, res) => {
      const status = req.query.status;
      const riders = await ridersCollection.find({ status }).toArray();
      res.send(riders);
    });

    // PATCH /riders/:id
    // app.patch('/riders/:id', async (req, res) => {
    //   const id = req.params.id;
    //   const { status } = req.body;
    //   const result = await ridersCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     { $set: { status } }
    //   );
    //   res.send(result);
    // });


    // tracking related data

    // post tracking 
    app.post('/tracking', async (req, res) => {
      const { trackingId, status, parcel_Id, message, updated_by = "" } = req.body;

      if (!trackingId || !status) {
        return res.status(400).send('trackingId and status required');
      }

      const now = new Date().toISOString();
      const newEntry = {
        trackingId,
        parcel_Id: parcel_Id ? new ObjectId(parcel_Id) : undefined,
        history: [{ status, time: now }],
        message,
        updated_by
      };

      await trackingCollection.insertOne(newEntry);
      res.send('Tracking entry created');
    });


    //get: update payment history
    app.get('/payments', verifiyFBToken, async (req, res) => {
      const email = req.query.email;
      let query = {};

      console.log("decoded request for get payment", req.decoded)
      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Access Forbidden For You" })
      }

      if (email) {
        query.created_By = email;
      }

      const result = await paymentHistoryCollection
        .find(query)
        .sort({ paymentTime: -1 }) // latest first
        .toArray();

      res.send(result);
    });


    // Post: update payment status and save payment history
    app.post('/payments', async (req, res) => {
      const { parcelId, transactionId, amount, created_By, paymentMethod } = req.body;

      if (!parcelId || !transactionId || !amount || !created_By) {
        return res.status(400).send({ message: 'Missing payment details' });
      }

      const paymentTime = new Date();

      // Step 1: Update parcel status to "paid"
      const parcelQuery = { _id: new ObjectId(parcelId) };
      const updateParcel = await parcelsCollections.updateOne(parcelQuery, {
        $set: {
          payment_Status: "paid",
          transactionId,
          paymentTime,
        },
      });

      // Step 2: Add entry to paymentHistory collection
      const paymentEntry = {
        parcelId: new ObjectId(parcelId),
        transactionId,
        amount,
        created_By,
        paymentMethod,
        paymentTime,
        paid_at_string: new Date().toISOString(),
        paid_at: new Date(),
      };

      const insertHistory = await paymentHistoryCollection.insertOne(paymentEntry);

      res.send({
        message: "✅ Payment recorded successfully",
        parcelUpdated: updateParcel.modifiedCount > 0,
        historyCreated: insertHistory.acknowledged,
      });
    });



    //payment system for stripe js
    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // amount in cents
          currency: 'usd',
          payment_method_types: ['card']
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


// Root route
app.get('/', (req, res) => {
  res.send('Parcel Delivery Server is Running!');
});

// Server listen
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
