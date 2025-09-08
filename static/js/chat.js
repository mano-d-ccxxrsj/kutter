import { createSuccessAlert, createErrorAlert } from "./index.js";

const DOM_ELEMENTS = {
  userInfoContainer: document.getElementById("userInfo"),
  modalBase: document.getElementById("modalBase"),
  userDetails: document.getElementById("userDetails"),
  userConfigModal: document.getElementById("userConfigModal"),
  userConfigModalCloseButton: document.getElementById(
    "userConfigModalCloseButton",
  ),
  userConfigModalLogoutButton: document.getElementById(
    "userConfigModalLogoutButton",
  ),
  modalPhotoConfig: document.getElementById("photoConfig"),
  version: document.getElementById("version"),
  modalPersonalInfo: document.getElementById("personalInfo"),
  fileInput: document.getElementById("photo-upload"),
  uploadButton: document.getElementById("upload-button"),
  friendReqInput: document.getElementById("friend_req_input"),
  friendReqButton: document.getElementById("friend_req_button"),
  friendRequests: document.getElementById("friend_requests"),
  friendsAccepted: document.getElementById("friends_accepted"),
  chatsContainer: document.getElementById("chats_container"),
  chatContainer: document.getElementById("chat_container"),
  topbar: document.getElementById("topbar"),
  topbarPhoto: document.getElementById("topbar_photo"),
  topbarUsername: document.getElementById("topbar_username"),
  inputContainer: document.getElementById("input_container"),
  sendMessageInput: document.getElementById("send_message_input"),
  sendMessageButton: document.getElementById("send_message_button"),
  changedMessageContainer: document.getElementById("changed_message_container"),
  chatsButton: document.getElementById("chats_button"),
  friendsButton: document.getElementById("friends_button"),
  left_side_wrapper: document.getElementById("left_side_wrapper"),
  right_side_wrapper: document.getElementById("right_side_wrapper"),
};

const APP_STATE = {
  currentTab: null,
  currentReply: null,
  currentUser: null,
  currentChatPartner: null,
  currentChatId: null,
  currentEdit: null,
  hasToast: null,
  renderedChats: new Set(),
  renderedMessages: new Set(),
  chats: new Array(),
  modalBase: {
    Details: {
      isActive: null,
    },
    userConfigModal: {
      isActive: null,
    },
  },
  sockets: {
    friendReq: null,
    chat: null,
  },
};

const Utils = {
  clearAppState: () => {
    if (APP_STATE.currentReply !== null) {
      const reply = document.getElementById(`reply_${APP_STATE.currentReply}`);
      const replyCloseButton = document.getElementById(
        `close_button_${APP_STATE.currentReply}`,
      );
      reply?.remove();
      replyCloseButton?.remove();
      APP_STATE.currentReply = null;
    }

    if (APP_STATE.currentEdit !== null) {
      const edit = document.getElementById(`edit_${APP_STATE.currentEdit}`);
      const editCloseButton = document.getElementById(
        `close_button_${APP_STATE.currentEdit}`,
      );
      edit?.remove();
      editCloseButton?.remove();
      APP_STATE.currentEdit = null;
    }

    DOM_ELEMENTS.changedMessageContainer.style.display = "none";
    DOM_ELEMENTS.chatContainer.style.marginBottom = "84px";
  },
  verifyToast: () => {
    const notification = document.getElementById("notification");
    if (notification) {
      notification.remove();
    }
  },
  formatTimestamp: (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();
    const time = date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const fullDate = date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return isToday ? `${time}` : `${fullDate} at ${time}`;
  },
  checkPfpExists: async (username) => {
    const pfpPath = `/uploads/${username}.png`;
    try {
      const response = await fetch(pfpPath, { method: "HEAD" });
      return response.ok
        ? pfpPath
        : "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
    } catch {
      return "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
    }
  },
};

const User = {
  init: async () => {
    const response = await fetch("/verify");
    const data = await response.json();

    if (data.status !== "success") {
      Utils.verifyToast();
      createErrorAlert("You are not logged in");
      setTimeout(() => window.location.replace("/login.html"), 1000);
      return false;
    }

    APP_STATE.currentUser = data.user;
    document.title = `Kutter - @${data.user.username}`;

    User.renderProfile(data.user);
    User.setupModal(data.user, data.user.biography);
    User.manageTabs();

    return true;
  },

  manageTabs: () => {
    DOM_ELEMENTS.chatsButton.addEventListener("click", () => {
      switch (APP_STATE.currentTab) {
        case 1:
          DOM_ELEMENTS.left_side_wrapper.style.display = "none";
          APP_STATE.currentTab = 0;
          break;
        case 0:
          DOM_ELEMENTS.left_side_wrapper.style.display = "flex";
          APP_STATE.currentTab = 1;
          break;
        case 2:
          DOM_ELEMENTS.left_side_wrapper.style.display = "flex";
          DOM_ELEMENTS.right_side_wrapper.style.display = "none";
          APP_STATE.currentTab = 1;
          break;
        case null:
          DOM_ELEMENTS.left_side_wrapper.style.display = "flex";
          APP_STATE.currentTab = 1;
          break;
      }
    });

    DOM_ELEMENTS.left_side_wrapper.addEventListener("blur", () => {
      DOM_ELEMENTS.left_side_wrapper.style.display = "none";
      APP_STATE.currentTab = 0;
    });

    DOM_ELEMENTS.right_side_wrapper.addEventListener("blur", () => {
      DOM_ELEMENTS.right_side_wrapper.style.display = "none";
      APP_STATE.currentTab = 0;
    });

    DOM_ELEMENTS.friendsButton.addEventListener("click", () => {
      switch (APP_STATE.currentTab) {
        case 1:
          DOM_ELEMENTS.right_side_wrapper.style.display = "flex";
          DOM_ELEMENTS.left_side_wrapper.style.display = "none";
          APP_STATE.currentTab = 2;
          break;
        case 0:
          DOM_ELEMENTS.right_side_wrapper.style.display = "flex";
          APP_STATE.currentTab = 2;
          break;
        case 2:
          DOM_ELEMENTS.right_side_wrapper.style.display = "none";
          APP_STATE.currentTab = 0;
          break;
        case null:
          DOM_ELEMENTS.right_side_wrapper.style.display = "flex";
          APP_STATE.currentTab = 2;
          break;
      }
    });
  },

  renderInfos: async (user) => {
    if (!APP_STATE.modalBase.Details.isActive) {
      DOM_ELEMENTS.modalBase.style.display = "flex";
      DOM_ELEMENTS.userDetails.style.display = "flex";
      APP_STATE.modalBase.Details.isActive = true;
    }

    const response = await fetch(`/users/${user}`);
    if (!response.ok) return;

    const data = await response.json();

    const photoDiv = document.createElement("div");
    photoDiv.classList.add("userIcon");
    const photo = document.createElement("img");
    photo.src = await Utils.checkPfpExists(data[0].username);
    photoDiv.appendChild(photo);
    DOM_ELEMENTS.userDetails.appendChild(photoDiv);

    const username = document.createElement("p");
    username.classList.add("username");
    username.textContent = `@${data[0].username}`;
    DOM_ELEMENTS.userDetails.appendChild(username);

    const close_button = document.createElement("div");
    close_button.classList.add("close-button");
    close_button.id = "userDetailsCloseButton";
    const close_button_icon = document.createElement("i");
    close_button_icon.classList.add("bx", "bx-x");
    close_button.appendChild(close_button_icon);
    DOM_ELEMENTS.userDetails.appendChild(close_button);

    if (data[0].biography) {
      const biography = document.createElement("p");
      biography.classList.add("biography");
      biography.textContent = `${data[0].biography}`;
      DOM_ELEMENTS.userDetails.appendChild(biography);
    }

    close_button.addEventListener("click", () => {
      DOM_ELEMENTS.userDetails.innerHTML = "";
      DOM_ELEMENTS.userDetails.style.display = "none";
      DOM_ELEMENTS.modalBase.style.display = "none";
      APP_STATE.modalBase.Details.isActive = false;
    });
  },

  renderProfile: (user) => {
    const photoDiv = document.createElement("div");
    photoDiv.classList.add("photo");
    const photoElement = document.createElement("img");
    photoElement.src = user.pfp_path;
    photoElement.onerror = () => {
      photoElement.src =
        "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
    };
    photoElement.alt = `${user.username.charAt(0)}`;
    photoDiv.appendChild(photoElement);
    DOM_ELEMENTS.userInfoContainer.appendChild(photoDiv);

    photoDiv.addEventListener("click", () => {
      DOM_ELEMENTS.modalBase.style.display = "flex";
      DOM_ELEMENTS.userConfigModal.style.display = "flex";
    });

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("name");
    nameDiv.textContent = `@${user.username}`;
    DOM_ELEMENTS.userInfoContainer.appendChild(nameDiv);
    nameDiv.addEventListener("click", () => User.renderInfos(user.username));
  },

  changeBio: (biography) => {
    const wsMessage = {
      action: "change_bio",
      payload: {
        biography: biography,
      },
    };

    APP_STATE.sockets.chat.send(JSON.stringify(wsMessage));
  },

  setupModal: (user, biography) => {
    DOM_ELEMENTS.userConfigModalCloseButton.addEventListener("click", () => {
      DOM_ELEMENTS.modalBase.style.display = "none";
      DOM_ELEMENTS.userConfigModal.style.display = "none";
    });

    DOM_ELEMENTS.topbarUsername.addEventListener("click", () =>
      User.renderInfos(APP_STATE.currentChatPartner),
    );

    DOM_ELEMENTS.version.addEventListener("click", () => {
      window.location.href = "/changelog.html";
    });

    DOM_ELEMENTS.userConfigModalLogoutButton.addEventListener(
      "click",
      async () => {
        await fetch("/logout", {
          method: "DELETE",
        });
        createSuccessAlert("Logout successfully");
        setTimeout(() => {
          window.location.replace("/");
        }, 1500);
      },
    );

    const modalPhotoDiv = document.createElement("div");
    modalPhotoDiv.classList.add("modalPhoto");
    const modalPhotoElement = document.createElement("img");
    modalPhotoElement.src = user.pfp_path;
    modalPhotoElement.onerror = () => {
      modalPhotoElement.src =
        "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
    };
    modalPhotoElement.alt = `${user.username.charAt(0)}`;
    modalPhotoDiv.appendChild(modalPhotoElement);
    DOM_ELEMENTS.modalPhotoConfig.prepend(modalPhotoDiv);

    const modalUsername = document.createElement("p");
    modalUsername.classList.add("name");
    modalUsername.textContent = `@${user.username}`;
    DOM_ELEMENTS.modalPersonalInfo.appendChild(modalUsername);

    const modalBiography = document.createElement("p");
    modalBiography.classList.add("biography-off");
    if (biography) {
      modalBiography.textContent = `${biography}`;
    }
    DOM_ELEMENTS.modalPersonalInfo.appendChild(modalBiography);

    const buttons = document.createElement("div");
    buttons.classList.add("buttons");

    const submitProfile = document.createElement("button");
    submitProfile.classList.add("submitProfile");
    submitProfile.textContent = "Done";
    submitProfile.addEventListener("click", () => {
      User.changeBio(modalBiography.textContent);
    });

    const editProfile = document.createElement("button");
    editProfile.classList.add("editProfile");
    editProfile.textContent = "Edit biography";
    editProfile.addEventListener("click", () => {
      modalBiography.classList.remove("biography-off");
      modalBiography.classList.add("biography-on");
      modalBiography.contentEditable = true;
      buttons.appendChild(submitProfile);
    });
    buttons.appendChild(editProfile);
    DOM_ELEMENTS.modalPersonalInfo.appendChild(buttons);

    DOM_ELEMENTS.fileInput.addEventListener("change", () => {
      if (DOM_ELEMENTS.fileInput.files.length > 0) {
        modalPhotoElement.src = URL.createObjectURL(
          DOM_ELEMENTS.fileInput.files[0],
        );
      }
    });

    DOM_ELEMENTS.uploadButton.addEventListener("click", async () => {
      const formData = new FormData();
      formData.append("file", DOM_ELEMENTS.fileInput.files[0]);

      const response = await fetch("/upload_avatar", {
        method: "POST",
        body: formData,
      });

      response.ok
        ? createSuccessAlert("Profile photo updated successfully")
        : createErrorAlert("Failed to update profile photo");
    });
  },
};

const Friends = {
  init: async () => {
    if (APP_STATE.sockets.friendReq) {
      APP_STATE.sockets.friendReq.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/friend_req`;

    APP_STATE.sockets.friendReq = new WebSocket(wsUrl);
    APP_STATE.sockets.friendReq.onopen = () =>
      console.log("Friend WebSocket connected");
    APP_STATE.sockets.friendReq.onmessage = Friends.handleMessage;
    APP_STATE.sockets.friendReq.onclose = () =>
      setTimeout(() => Friends.init(), 3000);

    await Friends.loadFriendRequests();
    DOM_ELEMENTS.friendReqButton.addEventListener(
      "click",
      Friends.sendFriendRequest,
    );
  },

  loadFriendRequests: async () => {
    const response = await fetch("/friend_req");
    if (!response.ok) return;

    const data = await response.json();
    data.forEach((request) => {
      const id = request.id;
      const isSender =
        APP_STATE.currentUser.username === request.sender_username;
      const otherUser = isSender
        ? request.receiver_username
        : request.sender_username;

      request.status === "accepted"
        ? Friends.acceptFriendRequest(otherUser, id)
        : Friends.createFriendRequest(otherUser, !isSender, id);
    });
  },

  createFriendRequest: (receiverUsername, appendButton, friendId) => {
    const friendRequest = document.createElement("div");
    friendRequest.classList.add("friend_request");
    friendRequest.id = friendId;

    const friendRequestP = document.createElement("p");
    friendRequestP.textContent = `@${receiverUsername}`;
    friendRequest.appendChild(friendRequestP);

    const acceptButton = document.createElement("button");

    if (!appendButton) {
      acceptButton.classList.add("waiting");
      acceptButton.textContent = "Waiting";
      acceptButton.disabled = true;
    } else {
      acceptButton.classList.add("accept_button");
      acceptButton.textContent = "Accept";
      acceptButton.addEventListener("click", () =>
        Friends.acceptRequest(friendId),
      );
    }

    friendRequest.appendChild(acceptButton);
    DOM_ELEMENTS.friendRequests.appendChild(friendRequest);
  },

  acceptRequest: async (friendId) => {
    const wsMessage = {
      action: "accept",
      payload: { friend_id: friendId },
    };
    try {
      APP_STATE.sockets.friendReq.send(JSON.stringify(wsMessage));
    } catch (e) {
      Utils.verifyToast();
      createErrorAlert("Error sending friend request");
    }
  },

  acceptFriendRequest: (username, friendRequestId) => {
    const friend = document.createElement("div");
    friend.classList.add("friend");
    friend.id = friendRequestId;

    const friendUsername = document.createElement("p");
    friendUsername.textContent = `@${username}`;
    friend.appendChild(friendUsername);

    const existingRequest = document.getElementById(friendRequestId);
    if (existingRequest) existingRequest.remove();

    DOM_ELEMENTS.friendsAccepted.appendChild(friend);
  },

  sendFriendRequest: () => {
    const receiverUsername = DOM_ELEMENTS.friendReqInput.value.trim();
    if (!receiverUsername) return;

    const wsMessage = {
      action: "send_request",
      payload: { receiver_username: receiverUsername },
    };

    try {
      APP_STATE.sockets.friendReq.send(JSON.stringify(wsMessage));
      DOM_ELEMENTS.friendReqInput.value = "";
    } catch (e) {
      Utils.verifyToast();
      createErrorAlert("Error sending friend request");
    }
  },

  handleMessage: (event) => {
    try {
      const data = JSON.parse(event.data);
      const user = APP_STATE.currentUser.username;

      switch (data.action) {
        case "send_request":
          const isSender = user === data.sender_username;
          Friends.createFriendRequest(
            isSender ? data.receiver_username : data.sender_username,
            !isSender,
            data.id,
          );
          if (!isSender)
            createSuccessAlert(
              `You received a friend request from @${data.sender_username}!`,
            );
          break;

        case "accept":
          const isReceiver = user === data.receiver_username;
          Friends.acceptFriendRequest(
            isReceiver ? data.sender_username : data.receiver_username,
            data.id,
          );
          const wsMessage = {
            action: "new_chat",
            payload: {
              second_user_name: isReceiver
                ? data.sender_username
                : data.receiver_username,
            },
          };
          APP_STATE.sockets.chat.send(JSON.stringify(wsMessage));
          setTimeout(() => Chat.loadChats(), 1500);
          createSuccessAlert("Friend request accepted");
          break;

        case "error":
          Utils.verifyToast();
          createErrorAlert(data.payload.message);
          break;
      }
    } catch (e) {
      console.error("Error processing friend message", e);
    }
  },
};

const Chat = {
  init: async () => {
    await Chat.setupWebSocket();
    await Chat.loadChats();

    function editMessage() {
      if (!APP_STATE.currentChatId) {
        Utils.verifyToast();
        createErrorAlert("Chat not ready. Please wait...");
        return;
      }

      if (
        !APP_STATE.sockets.chat ||
        APP_STATE.sockets.chat.readyState !== WebSocket.OPEN
      ) {
        Utils.verifyToast();
        createErrorAlert("Connection not ready. Please wait...");
        return;
      }

      const message = DOM_ELEMENTS.sendMessageInput.textContent.trim();
      if (!message) return;

      const wsMessage = {
        action: "edit_message",
        payload: {
          message_id: APP_STATE.currentEdit,
          message: message,
        },
      };

      try {
        APP_STATE.sockets.chat.send(JSON.stringify(wsMessage));
        DOM_ELEMENTS.sendMessageInput.textContent = "";
        if (APP_STATE.currentEdit !== null) {
          const edit = document.getElementById(`edit_${APP_STATE.currentEdit}`);
          const close_button = document.getElementById(
            `close_button_${APP_STATE.currentEdit}`,
          );
          edit.remove();
          close_button.remove();
          APP_STATE.currentEdit = null;
          DOM_ELEMENTS.changedMessageContainer.style.display = "none";
          DOM_ELEMENTS.chatContainer.style.marginBottom = "84px";
        }
      } catch (e) {
        Utils.verifyToast();
        createErrorAlert("Failed to edit message");
        console.error("Error editing message:", e);
      }
    }

    function sendMessage() {
      if (!APP_STATE.currentChatId) {
        Utils.verifyToast();
        createErrorAlert("Chat not ready. Please wait...");
        return;
      }

      if (
        !APP_STATE.sockets.chat ||
        APP_STATE.sockets.chat.readyState !== WebSocket.OPEN
      ) {
        Utils.verifyToast();
        createErrorAlert("Connection not ready. Please wait...");
        return;
      }

      const message = DOM_ELEMENTS.sendMessageInput.textContent.trim();
      if (!message || !APP_STATE.currentChatPartner) return;

      const wsMessage = {
        action: "new_message",
        payload: {
          message: message,
          chat_partner: APP_STATE.currentChatPartner,
          reply: APP_STATE.currentReply,
        },
      };

      try {
        APP_STATE.sockets.chat.send(JSON.stringify(wsMessage));
        DOM_ELEMENTS.sendMessageInput.textContent = "";
        if (APP_STATE.currentReply !== null) {
          const reply = document.getElementById(
            `reply_${APP_STATE.currentReply}`,
          );
          const close_button = document.getElementById(
            `close_button_${APP_STATE.currentReply}`,
          );
          reply.remove();
          close_button.remove();
          APP_STATE.currentReply = null;
          DOM_ELEMENTS.changedMessageContainer.style.display = "none";
          DOM_ELEMENTS.chatContainer.style.marginBottom = "84px";
        }
      } catch (e) {
        Utils.verifyToast();
        createErrorAlert("Failed to send message");
        console.error("Error sending message:", e);
      }
    }

    DOM_ELEMENTS.sendMessageButton.onclick = () => {
      if (!APP_STATE.currentEdit) {
        sendMessage();
      } else {
        editMessage();
      }
    };
    DOM_ELEMENTS.sendMessageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!APP_STATE.currentEdit) {
          sendMessage();
        } else {
          editMessage();
        }
      }
    });
  },

  setupWebSocket: async () => {
    return new Promise((resolve) => {
      if (APP_STATE.sockets.chat) {
        APP_STATE.sockets.chat.close();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      APP_STATE.sockets.chat = new WebSocket(wsUrl);

      APP_STATE.sockets.chat.onopen = () => {
        console.log("Chat WebSocket Connected");
        resolve();
      };

      APP_STATE.sockets.chat.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.action === "new_message") {
            Chat.reorderChats(data.chat_id);
            if (data.chat_id === APP_STATE.currentChatId) {
              const messageId = `${data.id}_${data.username}`;
              const can_change =
                APP_STATE.currentUser.username === data.username ? true : false;
              const has_reply =
                data.replied_user || data.replied_message ? true : false;
              if (!APP_STATE.renderedMessages.has(messageId)) {
                Chat.createMessage(
                  data.id,
                  data.username,
                  data.message,
                  data.replied_user,
                  data.replied_message,
                  data.time,
                  can_change,
                  has_reply,
                );
                APP_STATE.renderedMessages.add(messageId);
              }
            } else {
              createSuccessAlert(`New message from: @${data.username}`);
            }
          } else if (data.action === "delete") {
            const message_to_delete = document.getElementById(
              `${data.message_id}`,
            );
            if (message_to_delete) {
              message_to_delete.remove();
            }
          } else if (data.action === "new_chat") {
            const otherUser =
              APP_STATE.currentUser.username === data.first_user_name
                ? data.second_user_name
                : data.first_user_name;
            Chat.loadChats();
          } else if (data.action === "edit_message") {
            if (data.chat_id === APP_STATE.currentChatId) {
              const message = document.getElementById(`raw_${data.id}`);
              message.textContent = `${data.message}`;
              const messageInfo = document.getElementById(
                `message_info_${data.id}`,
              );
              const already_edited = document.getElementById(
                `edit_warning_${data.id}`,
              );
              if (!already_edited) {
                const edit_warning = document.createElement("p");
                edit_warning.textContent = "(edited)";
                edit_warning.classList.add("edit_warning");
                edit_warning.id = `edit_warning_${data.id}`;
                messageInfo.appendChild(edit_warning);
              }
            }
          } else if (data.action === "change_bio") {
            createSuccessAlert("Biography changed successfully");
          }
        } catch (e) {
          console.error("Error parsing chat message", e);
        }
      };

      APP_STATE.sockets.chat.onclose = () => {
        setTimeout(() => Chat.setupWebSocket(), 3000);
      };

      APP_STATE.sockets.chat.onerror = (error) => {
        console.error("WebSocket error:", error);
        Utils.verifyToast();
        createErrorAlert("Connection error. Reconnecting...");
        setTimeout(() => Chat.setupWebSocket(), 3000);
      };
    });
  },

  reorderChats: (chat_id) => {
    const old_chat = document.getElementById(`c${chat_id}`);
    const chat = APP_STATE.chats.find((chat_obj) => chat_obj.id === chat_id);
    if (APP_STATE.chats[0] !== chat) {
      old_chat.remove();
      Chat.createChat(chat.username, chat.pfp, chat.id, false);
    }
  },

  loadChats: async () => {
    const response = await fetch("/chats");
    if (!response.ok) {
      Utils.verifyToast();
      createErrorAlert("Error fetching chats");
      return;
    }

    const data = await response.json();

    for (const chat of data) {
      const chatId = `c${chat.id}`;
      const otherUser =
        APP_STATE.currentUser.username === chat.first_user_name
          ? chat.second_user_name
          : chat.first_user_name;

      const pfpUrl = await Utils.checkPfpExists(otherUser);
      Chat.createChat(otherUser, pfpUrl, chat.id, true);
      APP_STATE.renderedChats.add(chatId);
    }
  },

  createChat: (username, pfp, id, first_load) => {
    if (document.getElementById(`c${id}`)) return;

    const chatDiv = document.createElement("div");
    chatDiv.classList.add("chat");
    chatDiv.id = `c${id}`;

    const chatPhoto = document.createElement("div");
    chatPhoto.classList.add("photo");
    const chatImage = document.createElement("img");
    chatImage.src = pfp;
    chatImage.onerror = () => {
      chatImage.src =
        "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
    };
    chatImage.alt = `${username.charAt(0)}`;
    chatPhoto.appendChild(chatImage);

    const chatUsername = document.createElement("p");
    chatUsername.classList.add("username");
    chatUsername.textContent = `@${username}`;

    chatDiv.appendChild(chatPhoto);
    chatDiv.appendChild(chatUsername);

    let chat_array = {
      username: username,
      pfp: pfp,
      id: id,
    };

    let existing_chat = APP_STATE.chats.find((chat_obj) => chat_obj.id === id);

    if (existing_chat) {
      APP_STATE.chats = APP_STATE.chats.filter(
        (chat_obj) => chat_obj.id !== id,
      );
    }

    if (first_load) {
      DOM_ELEMENTS.chatsContainer.appendChild(chatDiv);
      APP_STATE.chats.push(chat_array);
    } else {
      DOM_ELEMENTS.chatsContainer.prepend(chatDiv);
      APP_STATE.chats.unshift(chat_array);
    }

    chatDiv.addEventListener("click", () => Chat.loadChat(id, username));
  },

  loadChat: async (chatId, username) => {
    if (chatId === APP_STATE.currentChatId) return;

    DOM_ELEMENTS.chatContainer.innerHTML = "";
    APP_STATE.renderedMessages.clear();
    APP_STATE.currentChatId = chatId;
    APP_STATE.currentChatPartner = username;

    if (APP_STATE.currentReply !== null) {
      const reply = document.getElementById(`reply_${APP_STATE.currentReply}`);
      const close_button = document.getElementById(
        `close_button_${APP_STATE.currentReply}`,
      );
      reply.remove();
      close_button.remove();
      APP_STATE.currentReply = null;
      DOM_ELEMENTS.changedMessageContainer.style.display = "none";
      DOM_ELEMENTS.chatContainer.style.marginBottom = "84px";
    }

    DOM_ELEMENTS.topbar.style.display = "flex";
    DOM_ELEMENTS.topbarPhoto.src = `/uploads/${username}.png`;
    DOM_ELEMENTS.topbarPhoto.onerror = () => {
      DOM_ELEMENTS.topbarPhoto.src =
        "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
    };
    DOM_ELEMENTS.topbarUsername.textContent = username;
    DOM_ELEMENTS.inputContainer.style.display = "flex";
    DOM_ELEMENTS.chatContainer.style.display = "flex";
    const sendMessageInput = DOM_ELEMENTS.sendMessageInput;
    function cleanUpInput() {
      if (sendMessageInput.innerHTML === "<br>") {
        sendMessageInput.innerHTML = "";
      }
    }

    sendMessageInput.addEventListener("focus", () => {
      cleanUpInput();
      if (
        sendMessageInput.textContent ===
        sendMessageInput.getAttribute("data-placeholder")
      ) {
        sendMessageInput.textContent = "";
      }
    });

    sendMessageInput.addEventListener("blur", () => {
      cleanUpInput();
      if (sendMessageInput.textContent === "") {
        sendMessageInput.textContent =
          sendMessageInput.getAttribute("data-placeholder");
      }
    });

    sendMessageInput.addEventListener("input", () => {
      cleanUpInput();
    });

    const response = await fetch(`/messages/${chatId}`);
    if (!response.ok) return;

    const messages = await response.json();
    messages.forEach((message) => {
      const messageId = `${message.id || message.timestamp}_${message.username}`;
      const can_change =
        APP_STATE.currentUser.username === message.username ? true : false;
      const has_reply =
        message.replied_user || message.replied_message ? true : false;
      if (!APP_STATE.renderedMessages.has(messageId)) {
        Chat.createMessage(
          message.id,
          message.username,
          message.message,
          message.replied_user,
          message.replied_message,
          message.time,
          can_change,
          has_reply,
          message.edited,
        );
        APP_STATE.renderedMessages.add(messageId);
      }
    });

    setTimeout(() => {
      DOM_ELEMENTS.chatContainer.scrollTop =
        DOM_ELEMENTS.chatContainer.scrollHeight;
    }, 100);
  },

  createMessage: (
    message_id,
    username,
    message,
    fetch_replied_user,
    fetch_replied_message,
    timestamp,
    can_change,
    has_reply,
    edited,
  ) => {
    const messageContainer = document.createElement("div");
    messageContainer.classList.add("message_container");
    const top = document.createElement("div");
    top.classList.add("top");
    const bottom = document.createElement("div");
    bottom.classList.add("bottom");

    const edit_warning = document.createElement("p");
    edit_warning.textContent = "(edited)";
    edit_warning.classList.add("edit_warning");
    edit_warning.id = `edit_warning_${message_id}`;

    if (has_reply) {
      const reply_container = document.createElement("div");
      reply_container.classList.add("replied_container");
      const replying_to = document.createElement("i");
      replying_to.classList.add("bx", "bx-reply");
      replying_to.style.transform = "scaleX(-1)";
      const reply_user = document.createElement("p");
      reply_user.textContent = `@${fetch_replied_user}:`;
      reply_user.classList.add("username");
      const reply_message = document.createElement("p");
      const photo = document.createElement("div");
      photo.classList.add("photo");
      const img = document.createElement("img");
      img.src = `/uploads/${fetch_replied_user}.png`;
      img.onerror = () => {
        img.src =
          "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
      };
      photo.appendChild(img);
      reply_message.textContent = fetch_replied_message;
      reply_container.appendChild(replying_to);
      reply_container.appendChild(photo);
      reply_container.appendChild(reply_user);
      reply_container.appendChild(reply_message);
      top.appendChild(reply_container);
      messageContainer.appendChild(top);
    }

    const options = document.createElement("div");
    options.classList.add("options");
    options.style.display = "none";
    const reply_button = document.createElement("p");
    reply_button.classList.add("buttons");
    reply_button.textContent = "Reply";
    reply_button.addEventListener("click", () => {
      DOM_ELEMENTS.sendMessageInput.focus();
      Utils.clearAppState();
      APP_STATE.currentReply = message_id;
      DOM_ELEMENTS.changedMessageContainer.style.display = "flex";
      DOM_ELEMENTS.chatContainer.style.marginBottom = "139px";
      DOM_ELEMENTS.chatContainer.scrollTop =
        DOM_ELEMENTS.chatContainer.scrollHeight;
      const reply = document.createElement("div");
      reply.classList.add("reply");
      reply.id = `reply_${message_id}`;
      const close_button = document.createElement("div");
      close_button.classList.add("close_button");
      close_button.id = `close_button_${message_id}`;
      const close_button_icon = document.createElement("i");
      close_button_icon.classList.add("bx", "bx-x");
      close_button.appendChild(close_button_icon);
      close_button.addEventListener("click", () => {
        APP_STATE.currentReply = null;
        reply.remove();
        close_button.remove();
        DOM_ELEMENTS.changedMessageContainer.style.display = "none";
        DOM_ELEMENTS.chatContainer.style.marginBottom = "84px";
      });
      const replied_message = document.createElement("p");
      const replied_user = document.createElement("p");
      replied_message.id = `replied_message_${message_id}`;
      replied_message.classList.add("replied_message");
      replied_user.id = `replied_user_${message_id}`;
      replied_user.classList.add("replied_user");
      replied_user.textContent = `@${username}:`;
      replied_message.textContent = `${message}`;
      reply.appendChild(replied_user);
      reply.appendChild(replied_message);
      DOM_ELEMENTS.changedMessageContainer.appendChild(reply);
      DOM_ELEMENTS.changedMessageContainer.appendChild(close_button);
    });
    options.appendChild(reply_button);

    const edit_button = document.createElement("p");
    edit_button.classList.add("buttons");
    edit_button.textContent = "Edit";
    edit_button.addEventListener("click", () => {
      const new_message = document.getElementById(`raw_${message_id}`); // change scope after
      DOM_ELEMENTS.sendMessageInput.focus();
      DOM_ELEMENTS.sendMessageInput.textContent = `${new_message.textContent}`;
      Utils.clearAppState();
      APP_STATE.currentEdit = message_id;
      DOM_ELEMENTS.changedMessageContainer.style.display = "flex";
      DOM_ELEMENTS.chatContainer.style.marginBottom = "139px";
      DOM_ELEMENTS.chatContainer.scrollTop =
        DOM_ELEMENTS.chatContainer.scrollHeight;
      const edit = document.createElement("div");
      edit.classList.add("edit");
      edit.id = `edit_${message_id}`;
      const close_button = document.createElement("div");
      close_button.classList.add("close_button");
      close_button.id = `close_button_${message_id}`;
      const close_button_icon = document.createElement("i");
      close_button_icon.classList.add("bx", "bx-x");
      close_button.appendChild(close_button_icon);
      close_button.addEventListener("click", () => {
        APP_STATE.currentEdit = null;
        edit.remove();
        close_button.remove();
        DOM_ELEMENTS.changedMessageContainer.style.display = "none";
        DOM_ELEMENTS.chatContainer.style.marginBottom = "84px";
      });
      const edit_message = document.createElement("p");
      const edit_warning = document.createElement("p");
      edit_message.id = `edit_message_${message_id}`;
      edit_message.classList.add("edit_message");
      edit_warning.id = `edit_warning_${message_id}`;
      edit_warning.classList.add("edit_warning");
      edit_warning.textContent = `Editing:`;
      edit_message.textContent = `${message}`;
      edit.appendChild(edit_warning);
      edit.appendChild(edit_message);
      DOM_ELEMENTS.changedMessageContainer.appendChild(edit);
      DOM_ELEMENTS.changedMessageContainer.appendChild(close_button);
    });

    const deleteWsMessage = {
      action: "delete_message",
      payload: {
        id: message_id,
      },
    };

    const delete_button = document.createElement("p");
    delete_button.classList.add("buttons");
    delete_button.textContent = "Delete";
    delete_button.addEventListener("click", () => {
      APP_STATE.sockets.chat.send(JSON.stringify(deleteWsMessage));
    });
    if (can_change) {
      options.appendChild(edit_button);
      options.appendChild(delete_button);
    }
    messageContainer.appendChild(options);

    const leftSide = document.createElement("div");
    leftSide.classList.add("left_side");
    const photoDiv = document.createElement("div");
    photoDiv.classList.add("photo");
    const photo = document.createElement("img");
    photo.src = `/uploads/${username}.png`;
    photo.onerror = () => {
      photo.src =
        "/uploads/40237818034128031427800137284873941207891342780912374098.jpg";
    };
    photoDiv.appendChild(photo);
    leftSide.appendChild(photoDiv);
    bottom.appendChild(leftSide);

    const rightSide = document.createElement("div");
    rightSide.classList.add("right_side");

    const messageInfo = document.createElement("div");
    messageInfo.classList.add("message_info");
    messageInfo.id = `message_info_${message_id}`;
    const messageUsername = document.createElement("p");
    messageUsername.classList.add("username");
    messageUsername.textContent = `@${username}`;
    const messageTimestamp = document.createElement("p");
    messageTimestamp.classList.add("timestamp");
    messageTimestamp.textContent = Utils.formatTimestamp(timestamp);
    messageInfo.appendChild(messageUsername);
    messageInfo.appendChild(messageTimestamp);
    if (edited) {
      messageInfo.appendChild(edit_warning);
    }
    rightSide.appendChild(messageInfo);

    const message_sub_container = document.createElement("div");
    message_sub_container.classList.add("message_sub_container");

    const rawMessage = document.createElement("p");
    rawMessage.classList.add("message");
    rawMessage.id = `raw_${message_id}`;
    rawMessage.textContent = message;
    message_sub_container.appendChild(rawMessage);

    rightSide.appendChild(message_sub_container);

    messageContainer.id = `${message_id}`;

    bottom.appendChild(rightSide);
    messageContainer.appendChild(bottom);
    messageContainer.addEventListener("mouseenter", () => {
      options.style.display = "flex";
    });
    messageContainer.addEventListener("mouseleave", () => {
      options.style.display = "none";
    });
    DOM_ELEMENTS.chatContainer.appendChild(messageContainer);

    setTimeout(() => {
      DOM_ELEMENTS.chatContainer.scrollTop =
        DOM_ELEMENTS.chatContainer.scrollHeight;
    }, 0);
  },
};

const initApp = async () => {
  const isAuthenticated = await User.init();
  if (!isAuthenticated) return;

  await Friends.init();
  await Chat.init();
};

window.addEventListener("beforeunload", () => {
  if (APP_STATE.sockets.chat) APP_STATE.sockets.chat.close();
  if (APP_STATE.sockets.friendReq) APP_STATE.sockets.friendReq.close();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
