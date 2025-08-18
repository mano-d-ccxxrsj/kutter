import { createErrorAlert, createSuccessAlert } from "./index.js";

const usernameInput = document.getElementById("usernameInput");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const confirmPasswordInput = document.getElementById("confirmPasswordInput");
const signinButton = document.getElementById("signButton");

signinButton.addEventListener("click", async (e) => {
  e.preventDefault();
  const username = usernameInput.value;
  const email = emailInput.value;
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (password !== confirmPassword) {
    createErrorAlert("Passwords do not match");
    return;
  }

  const response = await fetch("/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      email,
      password,
    }),
  });

  const data = await response.json();

  if (data.status === "success") {
    createSuccessAlert("Sign up successful");
    setInterval(() => {
      window.location.href = "/login.html";
    }, 1000);
  } else {
    createErrorAlert(data.message);
  }
});
