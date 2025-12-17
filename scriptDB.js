const Database = require('better-sqlite3');
const passport = require('passport');
const path = require('path');
const db = new Database(path.resolve(__dirname,  'users.db'));
//const db = new Database(path.resolve(__dirname,  'users.db'), { verbose: console.log });


// Create table
db.prepare(`CREATE TABLE IF NOT EXISTS users (
    ID INTEGER PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL
)`).run();


function createUserSignIn(myEmail, myUsername, myPassword) {
    const insert = db.prepare('INSERT INTO users (email, username, password) VALUES (@email, @username, @password)');

    console.log(myEmail, myUsername, myPassword);

    try {
        insert.run({
            email: myEmail,
            username: myUsername,
            password: myPassword
        });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {

            if (err.message.includes('users.email')) {
                throw new Error('Email already exists');
            }

            if (err.message.includes('users.username')) {
                throw new Error('Username already exists');
            }
        }

        throw err; 
    }
}

function checkUserLogin(myEmail, myPassword) {
    const check = db.prepare('SELECT ID as id FROM users WHERE email=? AND password=?');
    return check.get(myEmail, myPassword) || null;
}

function getUserDetails(id) {
    const check = db.prepare('SELECT username FROM users WHERE id=?');
    return check.get(id) || null;
}

function checkUserSignIn(myEmail, myUsername, myPassword) {
    const check = db.prepare('SELECT * FROM users WHERE email=? AND username=? AND password=?');
    return !!check.get(myEmail, myUsername, myPassword);
}

module.exports = {
  db,
  checkUserLogin,
  checkUserSignIn,
  createUserSignIn,
  getUserDetails
};