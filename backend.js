const express = require('express');

const path = require('path');

const sqlite = require("better-sqlite3");

const bodyParser = require('body-parser');
const { checkUserLogin, checkUserSignIn, createUserSignIn, getUserDetails } = require('./scriptDB');

const session = require("express-session")
const SqliteStore = require("better-sqlite3-session-store")(session)
const sessionDb = new sqlite("sessions.db");


const app = express();
const port = 3000;


app.set('view engine', 'ejs');
app.use(
    session({
        store: new SqliteStore({
            client: sessionDb,
            expired: {
                clear: true,
                intervalMs: 900000 //ms = 15min
            }
        }),
        secret: "keyboard cat",
        resave: false,
    })
)

app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.urlencoded({
    extended: true
}));

app.use(bodyParser.json())

app.get('/', (request, response)=>{
    const locals ={
        isLoggedIn: request.session.user !==undefined
    }
    response.render('index', locals);
})

app.get('/signout', (request, response)=>{
    delete request.session.user;
    response.redirect('/');
})

app.get('/page/blog', (request, response) => {
    const locals = {
        isLoggedIn: request.session.user !== undefined
    }
    response.render('blog', locals);
})

app.get('/page/gallery', (request, response) => {
    const locals = {
        isLoggedIn: request.session.user !== undefined
    }
    response.render('gallery', locals);
})
app.get('/page/shop', (request, response)=>{
    const locals = {
        isLoggedIn: request.session.user!== undefined}
    response.render('shop', locals);
})
app.get('/page/contact', (request, response) => {
    const locals = {
        isLoggedIn: request.session.user !== undefined
    }
    response.render('contact', locals);
})

app.get('/page/login', (request, response)=>{
    const locals = {
        isLoggedIn: request.session.user!==undefined
    }
    response.render('login', locals);
})

app.get('/page/signup', (request, response)=>{
    const locals = {
        isLoggedIn: request.session.user!==undefined
    }
    response.render('signup',locals);
})
app.get('/page/profile', (request, response) => {
    const locals = {
        isLoggedIn: request.session.user !== undefined,
        username: request.session.user?.username ?? 'anonymous',
    };
    response.render('profile', locals);
});


app.post('/api/login', (request, response) => {
    console.log("This is /api/login")
    console.log(request.body);

    const { email, password } = request.body;
    const myUser = checkUserLogin(email, password);

    if (!myUser) {
        return response.status(403).send('Bad request, invalid email or password');
    }

    console.log("data from db", myUser);
    request.session.user = myUser;

    return response.send('/page/profile');
});


app.post('/api/signin', (request, response) => {
    console.log("This is the api/signin speaking")
    console.log(request.body);

    const { email, username, password } = request.body;

    if (checkUserSignIn(email, username)) {
        console.log("Sign in failed.Email or username exits");
        return response.status(403).send("Email or username exits");
    }
    try {
        createUserSignIn(email, username, password);
        console.log("Signed in succesfully");
        return response.send('/api/login');
    }
    catch (err) {
        console.error(err);
        return response.status(500).send("Server error");
    }
});



app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
