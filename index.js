import express from 'express';
import snoowrap from 'snoowrap';
import { randomBytes } from 'crypto';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import cors from 'cors';
import { MongoClient, ServerApiVersion } from 'mongodb';

config();

const client = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const app = express();

app.use(cookieParser());

app.use(express.json());

// middleware to enable cors
app.use(cors());

app.get('/', (req, res) => {
  res.cookie('token', '', { maxAge: 0 });
  const authenticationUrl = snoowrap.getAuthUrl({
    clientId: process.env.CLIENT_ID,
    scope: ['history', 'identity'],
    redirectUri: 'http://localhost:3000/profile',
    permanent: false,
    state: randomBytes(8).toString('hex')
  });
  res.send(authenticationUrl);
})

app.post('/api/ccd', async (req, res) => {
  const s = await snoowrap.fromAuthCode({
    code: req.body.code,
    userAgent: 'Node app to get saved posts from reddit',
    clientId: process.env.CLIENT_ID,
    redirectUri: 'http://localhost:3000/profile',
    clientSecret: process.env.CLIENT_SECRET,
  }).then(r => {
    // if (req.cookies['token'] == undefined) {
    //   res.cookie('token', r.accessToken, {
    //     httpOnly: true,
    //     maxAge: 3600 * 1000
    //   })
    // } else {
    //   console.log('cookie is set: ' + req.cookies['token']);
    // }
    res.send({ token: r.accessToken });
  });
})


app.post('/api/getme', (req, res) => {
  const r = new snoowrap({
    userAgent: 'Node app to get saved posts from reddit',
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken: '',
    accessToken: req.body.token
  });
  r.getMe().then(ru => res.send({ name: ru.subreddit.display_name['display_name'] }));
})


app.post('/api/cats', async (req, res) => {

  const subreddit_set = new Set();
  const r = new snoowrap({
    userAgent: 'Node app to get saved posts from reddit',
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken: '',
    accessToken: req.body.token
  });
  
  (await r.getMe().getSavedContent()).fetchAll().then(submissions => {
    console.log(submissions.isFinished);
    submissions.map(sub => {
      subreddit_set.add(sub.subreddit.display_name);
    });
    res.send([...subreddit_set]);
  });
})

// method used to get the limit for /smol depending on how many I saved since last db logs insert 
app.post('/api/totalSavedReddit', async(req, res) => {
  const r = new snoowrap({
    userAgent: 'Node app to get saved posts from reddit',
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken: '',
    accessToken: req.body.token
  });
  (await r.getMe().getSavedContent()).fetchAll().then(submissions => res.send({ totalSaved: submissions.length }));
})


// --------- db insert methods -----------------
app.post('/api/smol', (req, res) => {
  const smol_arr = [];
  const r = new snoowrap({
    userAgent: 'Node app to get saved posts from reddit',
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken: '',
    accessToken: req.body.token
  });

  r.getMe().getSavedContent({ limit: req.body.limit === 0 ? -1 : req.body.limit }).then(async submissions => {
    submissions.map(sub => {
      smol_arr.push({
        'subreddit': sub.subreddit.display_name,
        'title': sub.title,
        'url': sub.url,
        'permalink': `https://www.reddit.com/${sub.permalink}`,
        'thumbnail': sub.thumbnail,
      });
    });
    try {
      await client.connect();
      const db = client.db('SavedPosts');
      console.log(`smol: Connected to database ${db.databaseName}`);
      // if there is 
      if (smol_arr.length > 0) {
        // db insert for logging purposes
        const logsCollection = db.collection('logs');
        const logsInsertCursor = await logsCollection.insertOne({
          username: req.body.name,
          last_logged: Date.now(),
          num_entries: req.body.lastLoggedTotal
        });
        console.log(`A document was inserted with the _id: ${logsInsertCursor.insertedId}`);
        // db insert of saved posts
        const savedCollection = db.collection('saved');
        const savedInsertCursor = await savedCollection.insertMany(smol_arr);
        console.log(`documents inserted to collection: ${savedInsertCursor.insertedCount}`);
        res.send({ message: 'Smol Insert Success' });
      } else { console.log('nothing to update'); res.send({ message: 'Nothing to update' }) }

    } catch (e) {
      console.error(`Somehting went wrong ${e}`);
    } finally {
      client.close();
    }
  });
});


app.post('/api/saved', async (req, res) => {
  const saved_arr = [];
  const r = new snoowrap({
    userAgent: 'Node app to get saved posts from reddit',
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken: '',
    accessToken: req.body.token
  });

  (await r.getMe().getSavedContent()).fetchAll().then(async submissions => {
    console.log('fetching done for all saved posts: '+submissions.isFinished);
    // console.log(submissions.length);
    submissions.map(sub => {
      saved_arr.push({
        'subreddit': sub.subreddit.display_name,
        'title': sub.title,
        'url': sub.url,
        'permalink': sub.permalink,
        'thumbnail': sub.thumbnail,
      });
    });
    try {
      await client.connect();
      const db = client.db('SavedPosts');
      console.log(`saved: Connected to database ${db.databaseName}`);
      // db insert for logging purposes
      const logsCollection = db.collection('logs');
      const logsInsertCursor = await logsCollection.insertOne({
        username: req.body.name,
        last_logged: Date.now(),
        num_entries: saved_arr.length
      });
      console.log(`A document was inserted with the _id: ${logsInsertCursor.insertedId}`);
      // db insert of saved posts
      const savedCollection = db.collection('saved');
      const savedInsertCursor = await savedCollection.insertMany(saved_arr);
      console.log(`documents inserted to collection: ${savedInsertCursor.insertedCount}`);
      res.send({ message: 'Big Insert Success' });
    } catch (e) {
      console.error(`Somehting went wrong ${e}`);
    } finally {
      client.close();
    }
  });
})

// --------- db find methods ------------
app.post('/api/checkLogs', async (req, res) => {
  try {
    await client.connect();
    const db = client.db('SavedPosts');
    console.log(`checkLogs: Connected to database ${db.databaseName}`);
    // find logs from db, migth need to index the logs username later....
    const logsCollection = db.collection('logs');
    const logsFindCursor = logsCollection.find({ username: req.body.name });
    const logsArr = await logsFindCursor.toArray();
    res.send({ logCheck: logsArr[logsArr.length-1] });
  } catch (e) {
    console.error(`Somehting went wrong ${e}`);
  } finally {
    client.close();
  }
});

app.post('/api/getSaved', async (req, res) => {
  try {
    await client.connect();
    const db = client.db('SavedPosts');
    console.log(`getSaved: Connected to database ${db.databaseName}`);
    // find posts according to the subreddit, might need to index the subreddit field later...
    const savedCollection = db.collection('saved');
    const savedFindCursor = savedCollection.find({ subreddit: req.body.subreddit }).sort({ _id: -1 });
    const savedArr = await savedFindCursor.toArray();
    res.send({ 'savedArr': savedArr });
  } catch (e) {
    console.error(`Somehting went wrong ${e}`);
  } finally {
    client.close();
  }
});

app.listen(8080, () => {
  console.log("Listening to port http://localhost:8080")
})
