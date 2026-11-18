// Copyright 2026 Alex Degner (alex@ergofox.me)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.scss";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="section app">
      <div className="container is-max-desktop">
        <h1 className="title is-2 has-text-centered">
          Welcome to Tauri + React
        </h1>
        <p className="subtitle has-text-centered">
          Click on the Tauri, Vite, and React logos to learn more.
        </p>

        <div className="columns is-mobile is-centered is-vcentered app-logos">
          <div className="column is-narrow">
            <a href="https://vite.dev" target="_blank" rel="noreferrer">
              <img src="/vite.svg" className="logo vite" alt="Vite logo" />
            </a>
          </div>
          <div className="column is-narrow">
            <a href="https://tauri.app" target="_blank" rel="noreferrer">
              <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
            </a>
          </div>
          <div className="column is-narrow">
            <a href="https://react.dev" target="_blank" rel="noreferrer">
              <img src={reactLogo} className="logo react" alt="React logo" />
            </a>
          </div>
        </div>

        <form
          className="box app-form"
          onSubmit={(e) => {
            e.preventDefault();
            greet();
          }}
        >
          <div className="field is-grouped">
            <div className="control is-expanded">
              <input
                id="greet-input"
                className="input"
                type="text"
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="Enter a name..."
              />
            </div>
            <div className="control">
              <button className="button is-primary" type="submit">
                Greet
              </button>
            </div>
          </div>
        </form>

        {greetMsg && (
          <article className="message is-primary app-message">
            <div className="message-body">{greetMsg}</div>
          </article>
        )}
      </div>
    </main>
  );
}

export default App;
