async function onSubmit() {
    const email = document.getElementsByName('email')[0].value;
    const username = document.getElementsByName('username')[0].value;
    const password = document.getElementsByName('password')[0].value;
    const remember = document.getElementsByName('remember')[0].value;


    const data = {
        email, username, password, remember
    };

    const url = '/api/signin';

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error("Response not ok");

        window.location.assign(await response.text());
    } catch (exception) {
        console.error(exception);
        window.location.assign('/');
    }
}


document.getElementById('signupBtn').addEventListener('click', onSubmit);