document.addEventListener("DOMContentLoaded", async () => {
  const response = await fetch("/verify");
  const data = await response.json();
  if (data.status === "success") {
    window.location.href = "/me.html";
  }
  return;
});
