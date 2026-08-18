document.addEventListener("DOMContentLoaded", () => {
  const title = document.querySelector(".tsd-page-toolbar .title");
  if (title) title.textContent = "glrs";
  document.querySelector(".tsd-navigation.settings")?.remove();
});
