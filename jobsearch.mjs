import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import request from 'request';
import session from 'express-session';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'your_secret_key', 
  resave: false,
  saveUninitialized: false
}));

const usersFilePath = path.join(__dirname, 'usersbase.txt');


// EMSI API, get access token 
// This is the API request for skills on resources page
const emsiOptions = {
  method: 'POST',
  url: 'https://auth.emsicloud.com/connect/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  form: {
    client_id: process.env.EMSI_CLIENT_ID || 'your own clied id', //when registering at the API webiste they give you your client id and secret 
    client_secret: process.env.EMSI_CLIENT_SECRET || 'your own client secret', //when registering at the API webiste they give you your client id and secret 
    grant_type: 'client_credentials',
    scope: 'emsi_open',
  },
};

let accessToken = null;
let tokenExpiry = null;

//This token resets every 30 minutes, so requesting it everytime you need to search for specific skills
async function getAccessToken() {
  return new Promise((resolve, reject) => {
    if (accessToken && new Date() < tokenExpiry) {
      return resolve(accessToken);
    }

    console.log('Requesting new access token...');
    request(emsiOptions, function (error, response, body) {
      if (error) {
        console.error('Error fetching access token:', error);
        return reject(error);
      }

      try {
        const data = JSON.parse(body);
        accessToken = data.access_token;
        tokenExpiry = new Date(new Date().getTime() + data.expires_in * 1000);
        console.log('Access token received:', accessToken);
        resolve(accessToken);
      } catch (parseError) {
        console.error('Error parsing access token response:', parseError);
        reject(parseError);
      }
    });
  });
}

// EMSI API, search for skills
app.get('/search-skills', async (req, res) => {
  const query = req.query.q;

  //q is the essential parameter for the query
  if (!query) {
    return res.status(400).send('Query parameter "q" is required');
  }

  console.log('Received search query:', query);

  try {
    const token = await getAccessToken();
    const options = {
      method: 'GET',
      url: 'https://emsiservices.com/skills/versions/latest/skills',
      qs: { q: query, fields: 'name', limit: '6' }, //the limit is up to 100
      headers: { Authorization: `Bearer ${token}` },
    };

    console.log('Fetching skills...');
    request(options, function (error, response, body) {
      if (error) {
        console.error('Error fetching skills:', error);
        return res.status(500).send('Error fetching skills');
      }

      try {
        const responseData = JSON.parse(body);
        const skills = responseData.data;
        if (!Array.isArray(skills)) {
          throw new Error('Skills data is not in the expected format');
        }

        console.log('Skills found:', skills);
        const skillNames = skills.map(skill => skill.name);
        res.send(skillNames.join(', '));
      } catch (parseError) {
        console.error('Error parsing skills data:', parseError);
        res.status(500).send('Error parsing skills data');
      }
    });
  } catch (error) {
    console.error('Error getting access token:', error);
    res.status(500).send('Error getting access token');
  }
});

//Profile route if someone try to access the resume page bu they are not logged in 
app.get('/resume', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login.html'); // Redirect if user is not logged in
  }
  res.sendFile(path.join(__dirname, 'public', 'resume.html'));
});

// Profile Route - Provide user data for resume page
app.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(200).json({ user: req.session.user });
});


// Login Route
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  fs.readFile(usersFilePath, 'utf8', (err, data) => {
      if (err) {
          console.error('Error reading users file:', err);
          return res.status(500).json({ error: 'An unexpected error occurred' });
      }

      try {
          const users = JSON.parse(data);

          const user = users.find(user => user.email === email && user.password === password);

          if (!user) {
              return res.status(401).json({ success: false, message: 'Invalid email or password' });
          }

          req.session.user = user;

          res.status(200).json({ success: true, message: 'Login successful', user });
      } catch (error) {
          console.error('Error parsing users data:', error);
          res.status(500).json({ success: false, message: 'An unexpected error occurred' });
      }
  });
});

app.post('/logout', (req, res) => {
  // Destroy session on logout
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ success: false, message: 'An unexpected error occurred' });
    }
    res.clearCookie('connect.sid');
    res.status(200).json({ success: true, message: 'Logout successful' });
  });
});

// Signup Route
app.post('/signup', (req, res) => {
  const { username, name, email, password, phoneNumber, address, postalCode, city } = req.body;

  fs.readFile(usersFilePath, 'utf8', (err, data) => {
      if (err && err.code !== 'ENOENT') { 
          console.error('Error reading users file:', err);
          return res.status(500).json({ error: 'An unexpected error occurred' });
      }

      try {
          const users = data ? JSON.parse(data) : []; 

          if (users.some(user => user.username === username || user.email === email)) {
              return res.status(400).json({ error: 'Username or email is already taken' });
          }

          const newUser = {
              id: users.length + 1,
              username,
              name,
              email,
              password,
              phoneNumber,
              address,
              postalCode,
              city
          };

          users.push(newUser);

          fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), (err) => {
              if (err) {
                  console.error('Error writing users file:', err);
                  return res.status(500).json({ error: 'An unexpected error occurred' });
              }

              res.status(201).json({ message: 'User created successfully', user: newUser });
          });
      } catch (error) {
          console.error('Error parsing users data:', error);
          res.status(500).json({ error: 'An unexpected error occurred' });
      }
  });
});

// Profile/Resume Route
app.get('/profile/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);

  fs.readFile(usersFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading users file:', err);
      return res.status(500).json({ error: 'An unexpected error occurred' });
    }

    try {
      const users = JSON.parse(data);
      const user = users.find(user => user.id === userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(200).json({ user });
    } catch (error) {
      console.error('Error parsing users data:', error);
      res.status(500).json({ error: 'An unexpected error occurred' });
    }
  });
});

// Job Search Route / Job API search 
app.post('/search', async (req, res) => {
  const query = req.body.q;

  const url = 'https://api.apijobs.dev/v1/job/search';
  const options = {
    method: 'POST',
    headers: {
      'apikey': 'your own API key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: query,
      published_since: "2024-01-01", 
      employment_type: "boards.greenhouse.io" //website from which the jobs are taken 
    })
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error fetching data');
  }
});

// Results Data Route
app.get('/results-data', (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'response.json'), (err, data) => {
    if (err) {
      console.error('Error reading file:', err);
      res.status(500).send('Error reading file');
    } else {
      const jobs = JSON.parse(data);
      res.json(jobs);
    }
  });
});

// Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 Handler
app.use((req, res, next) => {
  res.status(404).send('Sorry, page not found');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
