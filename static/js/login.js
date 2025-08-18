import { createErrorAlert, createSuccessAlert } from "./index.js";

const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginButton = document.getElementById("signButton");

loginButton.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = emailInput.value;
  const password = passwordInput.value;

  const response = await fetch("/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (data.status === "success") {
    createSuccessAlert("Log in successful!");
    setInterval(() => {
      window.location.href = "/me.html";
    }, 1000);
  } else {
    createErrorAlert(data.message);
  }
});
