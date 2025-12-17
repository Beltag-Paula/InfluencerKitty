const express = require('express');
const app = express();
const port = 3000;
const path = require('path');
const bodyParser = require('body-parser');
const { checkUserLogin, checkUserSignIn, createUserSignIn, getUserDetails } = require('./scriptDB');


app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.urlencoded({
    extended: true
}));

app.use(bodyParser.json())

app.post('/api/login', (request, response) => {
    console.log("This is /api/login")
    console.log(request.body);

    const { email, password } = request.body;
    const myUser = checkUserLogin(email, password);

    console.log(">>>>>", myUser);
    if (myUser) {
        return response.send(`/api/login/user/${myUser.id}`);
        // return response.redirect(303, `/api/login/user/${username}`); 
        // this is when you use <!-- <form action="/api/login" method="post"> --> from login-page.html so you won't need login js
    } else {
        return response.status(403).send('Bad request, invalid username or password').end();
    }

});

app.get('/api/login', (request, response) => {
    response.send("User profile");
});

app.get('/api/login/user/:id', (request, response) => {
    const user = getUserDetails(request.params.id);
    if (user) {
        response.setHeader('Content-Type', 'text/html; charset=UTF-8');
        response.send(`Hi ${user.username}!`);
    }
    else {
        return response.status(403).send('Bad request, invalid username or password').end();
    }

});

app.post('/api/signin', (request, response) => {
    console.log("This is the api/signin speaking")
    console.log(request.body);

    const { email, username, password } = request.body;

    if (checkUserSignIn(email, username, password)) {
        console.log("Sign in failed:");
        return response.status(403).send("Email or usenname exits");
    } else {
        console.log("Signed in successfully");
        return response.redirect('/api/login');
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});