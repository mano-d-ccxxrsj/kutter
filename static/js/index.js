const themeIcon = document.getElementById("theme-icon");
const themeButton = document.getElementById("theme-button");

function toggleTheme() {
  const theme = localStorage.getItem("theme");
  if (theme == "dark") {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
  } else {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  }
}

themeButton.addEventListener("click", toggleTheme);

document.addEventListener("DOMContentLoaded", () => {
  const theme = localStorage.getItem("theme");
  if (theme == "dark") {
    document.documentElement.classList.add("dark");
  } else if (theme == "light") {
    document.documentElement.classList.remove("dark");
  }
});

export function createErrorAlert(message) {
  const alertSpan = document.createElement("span");
  alertSpan.id = "notification";
  const theme = localStorage.getItem("theme");
  const dark = {
    color: "#c46c6c",
    backgroundColor: "#472222",
    border: "1px solid #c46c6c",
  };
  const light = {
    color: "#a80000",
    backgroundColor: "#e7bebe",
    border: "1px solid #a80000",
  };

  Object.assign(alertSpan.style, {
    position: "fixed",
    bottom: "10px",
    right: "10px",
    padding: "10px",
    id: "notification",
    color: theme === "dark" ? dark.color : light.color,
    backgroundColor:
      theme === "dark" ? dark.backgroundColor : light.backgroundColor,
    zIndex: "9999",
    border: theme === "dark" ? dark.border : light.border,
  });

  alertSpan.textContent = message;
  document.body.appendChild(alertSpan);

  setTimeout(() => {
    alertSpan.remove();
  }, 3000);
}

export function createSuccessAlert(message) {
  const alertSpan = document.createElement("span");
  alertSpan.id = "notification";
  const theme = localStorage.getItem("theme");
  const dark = {
    color: "#84c284",
    backgroundColor: "#1a3d1a",
    border: "1px solid #84c284",
  };
  const light = {
    color: "#007a00",
    backgroundColor: "#b2e7b2",
    border: "1px solid #007a00",
  };

  Object.assign(alertSpan.style, {
    position: "fixed",
    bottom: "10px",
    right: "10px",
    padding: "10px",
    color: theme === "dark" ? dark.color : light.color,
    backgroundColor:
      theme === "dark" ? dark.backgroundColor : light.backgroundColor,
    zIndex: "9999",
    border: theme === "dark" ? dark.border : light.border,
  });

  alertSpan.textContent = message;
  document.body.appendChild(alertSpan);

  setTimeout(() => {
    alertSpan.remove();
  }, 3000);
}
