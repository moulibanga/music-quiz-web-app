require("dotenv").config();
const { MongoClient } = require("mongodb");
const express = require("express");
const path = require("path");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("views", "templates");
app.set("view engine", "ejs");

const session = require("express-session");

app.use(
  session({
    secret: "quiz-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);

process.stdin.setEncoding("utf8");

const prompt = "Stop to shutdown the server: ";
if (process.argv.length !== 3) {
  console.log(`Usage: node app.js PORT`);
  process.exit(1);
}
const PORT = parseInt(process.argv[2]);

const uri = `mongodb+srv://${process.env.MONGO_DB_USERNAME}:${process.env.MONGO_DB_PASSWORD}@cluster0.ybhn75h.mongodb.net/${process.env.MONGO_DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);
let db;

async function startServer() {
  try {
    await client.connect();
    db = client.db(process.env.MONGO_DB_NAME);

    app.listen(PORT, () => {
      console.log(`Web server started and running at http://localhost:${PORT}`);
      process.stdout.write(prompt);
    });
  } catch (err) {
    process.exit(1);
  }
}

startServer();


app.get("/", (req, res) => {
  res.render("home", { pref: null }); 
});

app.post("/startQuiz", async (req, res) => {
  const { genres, artists, albums, songs, misc } = req.body;
  const apiKey = process.env.API_KEY;

  const artistList = artists.split(",").map(a => a.trim()).filter(Boolean);

  if (artistList.length === 0) {
    return res.status(400).send("You must enter at least one artist to start.");
  }

  const collection = db.collection("finalProject");
  await collection.deleteMany({ type: "preferences" });
  await collection.insertOne({
    type: "preferences",
    genres,
    artists,
    albums,
    songs,
    misc,
    savedAt: new Date(),
  });

  req.session.artistQueue = [...artistList];

  const current = req.session.artistQueue[0]; 

  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettopalbums&artist=${encodeURIComponent(
    current
  )}&api_key=${apiKey}&format=json&limit=10`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const albumList = data.topalbums?.album;
    if (!albumList || albumList.length === 0) {
      return res.status(404).send(`No albums found for artist: ${current}`);
    }

    const selectedAlbum = albumList[Math.floor(Math.random() * albumList.length)];
    const quizData = {
      albumCoverUrl:
        selectedAlbum.image?.[3]?.["#text"] ||
        selectedAlbum.image?.[2]?.["#text"],
      correctAnswer: selectedAlbum.name,
    };

    res.render("quiz", { quiz: quizData });
  } catch (err) {
    console.error("Error starting quiz:", err);
    res.status(500).send("Failed to load starting quiz.");
  }
});



app.post("/submit", (req, res) => {
  const { userAnswer, correctAnswer, action } = req.body;

  if (action !== "end") {
    const isCorrect =
      userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();

    if (!req.session.total) req.session.total = 0;
    if (!req.session.correct) req.session.correct = 0;

    req.session.total++;
    if (isCorrect) req.session.correct++;

    return res.render("results", { isCorrect, correctAnswer });
  }

  res.redirect("/end");
});

app.get("/viewPreferences", async (req, res) => {
  const collection = db.collection("finalProject");
  const pref = await collection.findOne(
    { type: "preferences" },
    { sort: { savedAt: -1 } }
  );

  res.render("viewPreferences", { pref });
});

app.get("/loadPreferences", async (req, res) => {
  const collection = db.collection("finalProject");
  const pref = await collection.findOne(
    { type: "preferences" },
    { sort: { savedAt: -1 } }
  );
  res.render("home", { pref }); 
});

app.get("/nextQuiz", async (req, res) => {
  const apiKey = process.env.API_KEY;

  const queue = req.session.artistQueue;

  if (!queue || queue.length === 0) {
    return res.send("No more artists available to quiz on.");
  }

  const current = queue.shift();
  queue.push(current);

  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettopalbums&artist=${encodeURIComponent(
    current
  )}&api_key=${apiKey}&format=json&limit=10`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const albumList = data.topalbums?.album;
    if (!albumList || albumList.length === 0) {
      return res.status(404).send(`No albums found for artist: ${current}`);
    }

    const selectedAlbum =
      albumList[Math.floor(Math.random() * albumList.length)];
    const quizData = {
      albumCoverUrl:
        selectedAlbum.image?.[3]?.["#text"] ||
        selectedAlbum.image?.[2]?.["#text"],
      correctAnswer: selectedAlbum.name,
    };

    res.render("quiz", { quiz: quizData });
  } catch (err) {
    console.error("Error fetching quiz:", err);
    res.status(500).send("Failed to load quiz.");
  }
});



app.get("/end", (req, res) => {
  const { correct = 0, total = 0 } = req.session;
  const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : "0.0";

  res.render("end", { correct, total, accuracy });

  req.session.destroy();
});

process.on("SIGINT", async () => {
  await client.close();
  process.exit(0);
});

process.stdin.on("readable", function () {
  let input;
  while ((input = process.stdin.read()) !== null) {
    const command = input.trim().toLowerCase();
    if (command === "stop") {
      client.close().then(() => process.exit(0));
    } else {
      process.stdout.write(`Invalid command: ${command}\n`);
      process.stdout.write(prompt);
    }
  }
});
