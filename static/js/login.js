import { createErrorAlert, createSuccessAlert } from "./index.js";

const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginButton = document.getElementById("signButton");
const modalBase = document.getElementById("modalBase");

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
  } else if (data.message === "email not verified") {
    modalBase.style.display = "flex";
    modalBase.addEventListener("click", () => {
      modalBase.style.display = "none";
    });
  } else {
    createErrorAlert(data.message);
  }
});
