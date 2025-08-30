# Kutter

## Real time chatting web application

![Kutter](https://github.com/Icarox52/kutter/blob/main/static/imgs/banner.png)

Kutter is a real time chatting web application with a focus on speed and simplicity without that polluted design.

Kutter is writen in Rust with Actix Web and Actix Websocket for maximum performance.

# Routes and how to get it on Frontend

## HTTP:
| Route | Description | Type |
| :--- | :---: | :---: |
| `/register` | Get `username`, `email` and `password` and insert it to database | POST |
| `/login` | Get `email` and `password` and try to select it in database, if it exists, return a token with `username` and `email`, else return an error | POST |
| `/upload_avatar` | Get `fileInput` content and, save the image in /uploads(repository root directory) with `username` as name and convert it to png. Database receives only url of the image | POST |
| `/verify` | Get `token` and try to select it in database, if it exists, return a token with `username` and `email`, else return an error | POST |

# continue if u want, i have bigger problems
