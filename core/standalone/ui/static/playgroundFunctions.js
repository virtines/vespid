/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

$(document).ready(function(){
  // This is the location of the supporting API
  // The host value may get replaced in PlaygroundLauncher to a specific host
  window.APIHOST='http://localhost:3233'

  // To install in a different namespace, change this value
  window.PLAYGROUND='whisk.system'

  // Keys for cookies
  window.colorKey = 'colorId'
  window.languageKey = 'language'
  window.playgroundIdKey = 'playgroundId'
  window.actionKey = 'vname'

  // Initialize GUI elements
  window.editor = initializeEditor()
  window.colorSetting = initializeColor()

  // The language table (a JS object acting as an associative array)
  // Maps from language symbol to structure (1) repeating the symbol as 'name', (2) the editor mode,
  // (3) the whisk runtime 'kind' to use for the language, and (4) the starting example code for that language.
  window.languages = {
    JavaScript: {
        name: "JavaScript",
        editMode: "ace/mode/javascript",
        kind: "js",
        example:`function offset(num) { return num + 10; };`
    },

    JSNative: {
        name: "JSNative",
        editMode: "ace/mode/javascript",
        kind: "jsnative",
        example:`function offset(num) { return num + 10; };`
    },

    Python: {
        name: "Python",
        editMode: "ace/mode/python",
        kind: "python",
        example: `def main(args):
    if 'name' in args:
        name = args['name']
    else:
        name = "stranger"
    greeting = "Hello " + name + "!"
    print(greeting)
    return {"body": greeting}
`
    },

    Swift: {
        name: "Swift",
        editMode: "ace/mode/swift",
        kind: "swift",
        example:`func main(args: [String:Any]) -> [String:Any] {
         if let name = args["name"] as? String {
        let greeting = "Hello \\(name)!"
        print(greeting)
        return [ "body" : greeting ]
    } else {
        let greeting = "Hello stranger!"
        print(greeting)
        return [ "body" : greeting ]
    }
}`
    },

    Go: {
        name: 'Go',
        editMode: 'ace/mode/go',
        kind: `go`,
        example: `package main

func Main(args map[string]interface{}) map[string]interface{} {
  name, ok := args["name"].(string)
  if !ok {
    name = "stranger"
  }
  msg := make(map[string]interface{})
  msg["body"] = "Hello, " + name + "!"
  return msg
}`
    },

    PHP: {
        name: 'PHP',
        editMode: 'ace/mode/php',
        kind: `php`,
        example: `<?php
function main(array $args) : array {
    $name = $args["name"] ?? "stranger";
    $greeting = "Hello $name!";
    echo $greeting;
    return ["body" => $greeting];
}`
    },

    c: {
        name: 'c',
        editMode: 'ace/mode/c_cpp',
        kind: 'c',
        example: `int add(int a, int b){
  return a+b;
}`
    },

    cnative: {
        name: 'cnative',
        editMode: 'ace/mode/c_cpp',
        kind: `cnative`,
        example: `int add(int a, int b){
  return a+b;
}`
    }
  }

  // Other initialization
  window.playgroundId = initializePlaygroundId()
  window.EditSession = require("ace/edit_session").EditSession  // Per ACE doc
  window.activeSessions = []  // Contains triples {vname, EditSession, webbiness} for actions visited in this browser session
  window.editorContentsChanged = false  // A 'dirty' flag consulted as part of autosave logic
  window.language = initializeLanguage()  // Requires languages table to exist
  window.actionList = []   // Populated asynchronously by initializeUserPackage.  Contains pairs {vname, actionKind}
  window.currentAction = null // Name of the action displayed in the editor and actionSelector.  Initialized by initializeActionSelector.
  window.entryFollowup = null // Function to execute when name entry completes (for renameAction and startNewAction).  Null except during name entry.
  document.onkeydown = detectEscapeKey // Examine key presses to see if they indicate a desire to cancel name input mode

  initializeUserPackage().then(initializeActionSelector).then(startAutosave)
});

// Start autosave polling
function startAutosave() {
  window.setInterval(maybeSave, 15 * 1000)
}

// Initialize the playgroundId
function initializePlaygroundId() {
  let playgroundId = getCookie(window.playgroundIdKey)
  if (playgroundId == "") {
    playgroundId = (new Date().getTime()) % 1000000
    console.log('New playgroundId: ', playgroundId)
  } else {
    console.log('Existing playgroundId: ', playgroundId)
  }
  setCookie(window.playgroundIdKey, playgroundId) // regardless of whether it was set before; refreshes expiration
  return playgroundId
}

// Initialize the actionList to reflect the user's package structure stored on the server, perhaps creating a new package for a new user
// with no actions.  Returns a promise.  Initialization code dependent on the action list should be in the promise chain.
function initializeUserPackage() {
  console.log("Initializing user", window.playgroundId)
  return makeOpenWhiskRequest("list", { playgroundId: window.playgroundId }).then(result => {
    console.log("userpackage raw response:", result)
    let userPackage = JSON.parse(result)
    if (userPackage && userPackage.actions && Array.isArray(userPackage.actions)) {
      for (action of userPackage.actions) {
        window.actionList.push({ name: action.vname, kind: action.runtime } )
      }
    }
    return window.actionList   // For definiteness, to carry on the promise chain.  actionList is also global.
  }).catch(err => {
    console.error("Error getting user package.", err)
  })
}

// Initialize the actions in the action selector and select one (also assigning currentAction) based on a user cookie.
// Assumes the 'language' global variable is initialized.  Only actions in that language are listed.
// If the cookie is not set, or it denotes an action for a non-selected language, we arbitrarily select the first action
// of the selected language and also put it into the cookie.  End by calling 'imposeAction' to initialize the editor session
// for the action, returning the result thereof which is a Promise.  Editor code may be filled in asynchronously.
function initializeActionSelector(actionList) {
  const selector = elem("actionSelector")
  // Determine the list of action names that should be used.
  // Start with those that can be read from the user's package (pre-existing).
  // Add a sample for the current language iff the user has no actions for that language.
  console.log(actionList)
  let actions = actionList.filter(action => matchesLanguage(action))
  console.log("read", actions.length, "actions from user package")
  if (actions.length == 0) {
    console.log("adding sample for", window.language.name)
    actions.push({ name: "sample" + window.language.name, kind: window.language.kind} )
  }
  // Place the action names in the selector's options
  selector.options.length = 0
  for (action of actions) {
    console.log("adding action to selector", action.name)
    selector.options[selector.options.length] = new Option(action.name, action.name)
  }
  // Add other capabilities to the action list.
  // Add --New Action-- iff the user is within his quota.  Add --Delete-- iff there is more than one action.
  // Add --Rename-- unconditionally.  However, --Rename-- and --Delete-- are also enabled/disabled as part of
  // the imposeWebbiness function (when the action isn't editable it seems illogical that you can rename and delete it)
  if (actions.length < 10) { // quota is arbitrary
    let other = "--New Action--"
    console.log("adding capability", other)
    selector.options[selector.options.length] = new Option(other, other)
  }
  if (actions.length > 1) {
    let other = "--Delete--"
    console.log("adding capability", other)
    selector.options[selector.options.length] = new Option(other, other)
  }
  let other = "--Rename--"
  console.log("adding capability", other)
  selector.options[selector.options.length] = new Option(other, other)
  // Now select the action according to the user's cookie (if present and applicable) else arbitrarily choose
  // the first (or only) list element.  The list has at least one action at this point.
  const cookieVal = getCookie(window.actionKey)
  window.currentAction = (cookieVal != "" && matchesLanguageByName(cookieVal)) ? cookieVal : actions[0].name
  selector.value = window.currentAction
  setCookie(window.actionKey, window.currentAction)
  return imposeAction(window.currentAction)
}

// Initialize the editor
function initializeEditor() {
    editor = ace.edit("editor");
  editor.setTheme("ace/theme/monokai");
  editor.setShowPrintMargin(false);
  elem('editor').style.fontSize='12pt';
  return editor
}

// Initialize the color theme
function initializeColor() {
  let color = getCookie(window.colorKey)
  if (color == "") {
    color = "dark"
  }
  imposeColor(color)
  return color
}

// Initialize the language
function initializeLanguage() {
  // First initialize the options of the language selector from the language table
  var selector = elem("languageSelector")
  selector.options.length = 0 // probably unneeded but just in case this gets done more than once
  for (member in window.languages) {
    let languageName = window.languages[member].name
    if (languageName == "JSNative" || languageName == "JavaScript" || languageName == "c" || languageName == "cnative"){
      console.log("Adding language " + languageName + " to selector")
      selector.options[selector.options.length] = new Option(languageName, languageName)
    }
  }
  console.log("Selector now has " + selector.options.length + " choices")
  // Retrieve the language choice from the cookie or set to default
  var language = window.languages.JavaScript // Default
  let languageName = getCookie(window.languageKey)
  if (languageName != "") {
    language = window.languages[languageName]
    console.log("Language " + languageName + " was retrieved from the cookie")
  } else {
    console.log("Language defaulted to " + language.name)
    setCookie(window.languageKey, language.name)
  }
  // Set the language into the selector
  selector.value = language.name
  return language
}

// Examine key presses looking for esc
function detectEscapeKey(evt) {
  evt = evt || window.event;
  var isEscape = false;
  if ("key" in evt) {
    isEscape = (evt.key == "Escape" || evt.key == "Esc");
  } else {
    isEscape = (evt.keyCode == 27);
  }
  if (isEscape && window.entryFollowup != null) {
    console.log("Cancel detected via esc key")
    endNameEntry()
  }
}

// Test whether an action (from the action list) matches the current language (the action {name, kind} pair is the argument)
function matchesLanguage(action) {
  console.log("matching", action.name, "for kind", window.language.kind)
  let matched = action.kind === window.language.kind
  console.log("matched", matched)
  return matched
}

// Test whether an action matches the current language (language name given)
// Answers false if the action isn't found.
function matchesLanguageByName(vname) {
  let action = getAction(vname)
  return action ? matchesLanguage(action) : false
}

// Lookup an action by name in the actionList.
function getAction(vname) {
  let index = indexOfAction(vname)
  if (index < 0) {
    return undefined
  }
  return window.actionList[index]
}

// Find the index of an action name in the action list
function indexOfAction(vname) {
  for (i = 0; i < window.actionList.length; i++) {
    if (window.actionList[i].name == vname) {
      return i
    }
  }
  return -1
}

// Change the language in response to a change in the language selector
function languageChanged() {
  const newName = elem("languageSelector").value
  if (window.language.name == newName) {
    // Avoid disruption if not really changed (not sure if this can actually happen but just in case)
    return
  }
  maybeSave()   // Before language change: saves previous contents.  Save is asynchronous but racing with the
  // following is ok because the asynchronous part of save follows the network send.  Once the network send
  // has occurred, the local state is free to change (if the save fails there is no real recovery).
  // Change the language global variable and reset the cookie
  window.language = window.languages[newName]
  setCookie(window.languageKey, newName)
  // Redo action selector initialization.  This returns a promise but we need not hook it because
  // we are running in response to a UI event and things can settle in any order.
  initializeActionSelector(window.actionList)
}

// Change the selected action or process the special options (new/rename/delete) that are handled via that selector
function actionChanged() {
  let newAction = elem("actionSelector").value
  if (newAction == window.currentAction) {
    return
  } else if (newAction.startsWith("--")) {
    switch (newAction.charAt(2)) {
    case 'N':
      nameEntry(completeNewAction)
      break
    case 'R':
      nameEntry(completeRename)
      break
    case 'D':
      deleteAction()
      break
    }
  } else {
    maybeSave()   // Save previous contents. Save is asynchronous but racing with the following is ok because the
    // asynchronous part of save follows the network send.  Once the network send has occurred, the local state is
    // free to change (if the save fails there is no real recovery).
    window.currentAction = newAction
    setCookie(window.actionKey, window.currentAction)
    imposeAction(window.currentAction)
  }
}

// Start a name entry sequence (for rename or new action)
function nameEntry(followup) {
  window.entryFollowup = followup
  const selector = elem("actionSelector")
  const entry = elem("nameInput")
  selector.style.display = "none"
  entry.style.display = "block"
  entry.value = ""
  entry.focus()
}

// End the name entry phase, either after processing a valid name or after cancellation
function endNameEntry() {
  window.entryFollowup = null
  const selector = elem("actionSelector")
  const entry = elem("nameInput")
  selector.style.display = "block"
  entry.style.display = "none"
  console.log("Name entry ending.  Setting selector to the correct action", window.currentAction)
  selector.value = window.currentAction
}

// Followup after user enters the name of a new action
function completeNewAction(newName) {
  window.actionList.push({ name: newName, kind: window.language.kind })
  window.currentAction = newName
  endNameEntry()
  setCookie(window.actionKey, window.currentAction)
  initializeActionSelector(window.actionList)
}

// Followup after user renames an existing action
function completeRename(newName) {
  let action = getAction(window.currentAction)
  if (action) {
    let oldName = window.currentAction
    // Rename locally
    action.name = newName
    window.currentAction = newName
    // Resave under the new name, delete old copy on success
    let web = elem("create").value != 'Create' // The presence of a Publish button means locally editable.
    save(web).then(_ => deleteRemote(oldName))
    // Restabilize action selector and editor
    setCookie(window.actionKey, newName)
    initializeActionSelector(window.actionList)
  } else {
    // Should not happen
    console.log(window.currentAction, "not found in action list", window.actionList)
  }
  endNameEntry()
}

// Delete the current action
function deleteAction() {
  // Get index of current action in action list
  let index = indexOfAction(window.currentAction)
  if (index < 0) {
    // Should not happen
    console.log("current action not found in action list", window.currentAction)
    endNameEntry()
    return
  }
  // Remove locally
  window.actionList.splice(index, 1)
  // Remove remotely
  deleteRemote(window.currentAction)
  // Restabilize the action selector, window.currentAction, and current cookie based on what's left in the list
  initializeActionSelector(window.actionList)
  // Don't end name entry until a new currentAction has been nominated
  endNameEntry()
}

// Delete the remote copy of an action if present.  If absent, no error is indicated except on the console.  Local processing
// proceeds in either case.
function deleteRemote(vname) {
  return makeOpenWhiskRequest(vname+'/delete', { playgroundId: window.playgroundId, vname: vname }).then(result => {
    console.log("deleted", vname)
    setAreaContents("resultText", result.result, false)
    console.log("full result", result)
  }).catch(err => {
    console.log("not deleted (perhaps doesn't exist)", vname)
    console.log("full error object", err)
  })
}

// Fetch code from a deployed action.   Returns a promise, for chaining purposes, but both the resolve and the reject path simply provide the
// action name.  Code, if retrieved, is placed directly in the editor.  Failure to retrieve code is tolerated as a sometimes-expected condition.
function getCode(vname) {
  return makeOpenWhiskRequest(vname+'/get', { playgroundId: window.playgroundId, vname: vname }).then(result => {
       let response = JSON.parse(result)
       console.log("getCode response", response)
       if ('result' in response) {
         console.log("Code retrieved from deployed action")
           let code = response.result.vcode
           
          let params = get_parameters(code)
          elem("input").value = JSON.stringify(params, null, 4)
           window.editor.setValue(code)
           editorContentsChanged = false // Setting the editor contents will fire the change event but there is no need to re-save.
       } else {
         console.log("No deployed action, no code retrieved")
       }
       let webbiness = isWeb(response)
       imposeWebbiness(webbiness)
       return vname
  }).catch(err => {
    console.error("Error retrieving code", err)
    imposeWebbiness(false)
    return vname
  })
}

// Determine if an action being fetched is a web action by examining its annotations.  The argument is the response to a wsk get operation on the
// action.   If there are no annotations in the response, the answer is false.
function isWeb(response) {
  return getAnnotation(response, "web-export") === true // ensures boolean
}

// Get an annotation from an object that may or may not have an 'annotations' member (as whisk responses generally do).  Returns undefined if
// (1) The 'annotations' member is absent.  (2) The 'annotations' member's members are not key value pairs.  (3) The 'annotations' member does not
// contain a key value pair matching the requested annotation.  On a match, returns the value of the annotation.
function getAnnotation(object, name) {
  if ('annotations' in object && Array.isArray(object.annotations)) {
    for (i = 0; i < object.annotations.length; i++) {
      let member = object.annotations[i]
      if (member.key === name) { // false if no key
        return member.value // undefined if no value
      }
    }
  }
  return undefined
}

// Impose the local conventions for a currently published (web) action (argument is true) or a private (non-web) action (argument is false)
function imposeWebbiness(isWeb) {
  console.log("Webbiness being set to " + isWeb)
  let button = elem("create")
  let urlText = elem("urlText")
  let actionSelector = elem("actionSelector")
  let mutableOptions = []  // For some reason, select.options doesn't support 'filter' (backlevel JS?)
  for (i = 0; i < actionSelector.options.length; i++) {
    let option = actionSelector.options[i]
    if (option.value == "--Rename--" || option.value == "--Delete--") {
      mutableOptions.push(option)
    }
  }
  if (isWeb) {
    button.innerHTML = '<i class="material-icons icon-size icon-extra-margin">cloud_download</i>Edit'
    setReadOnly(true)
    const url = window.APIHOST + '/api/v1/web/' + window.PLAYGROUND + '/user' + window.playgroundId + '/' + window.currentAction
    urlText.innerHTML = "Readonly, public at <a style='text-decoration:none;color:#488' href='" + url + "'>" + url + "</a>"
    for (opt of mutableOptions) {
      opt.disabled = true
    }
  } else {
    button.innerHTML = '<i class="material-icons icon-size icon-extra-margin">cloud_upload</i>Create'
    setReadOnly(false)
    urlText.innerHTML = "[ editable, private ]"
    for (opt of mutableOptions) {
      opt.disabled = false
    }
  }
  // Record the webbiness in the session record
  getSession(window.currentAction).isWeb = isWeb
  // Since this may be called as part of publish or edit, remove focus from the button
  button.blur()
}

// Sets the readonly properties of the editor on or off.  A thorough job, including a proper visual indication,
// requires taggling several properties
function setReadOnly(on) {
  window.editor.setOptions({readOnly: on, highlightActiveLine: !on, highlightGutterLine: !on});
  window.editor.renderer.$cursorLayer.element.style.display = on ? "none" : ""
  if (on) {
    window.editor.clearSelection()
  }
}

// Parse out a specific cookie by key
function getCookie(key) {
  let keyPrefix = key + "=";
    let cookie = decodeURIComponent(document.cookie)
    let parts = cookie.split(';');
    for(var i = 0; i <parts.length; i++) {
      let p = parts[i].trim()
        if (p.startsWith(keyPrefix)) {
          return p.substring(keyPrefix.length)
        }
    }
    return ""
}

// Set a specific cookie by key (note that the document.cookie field has asymmetric behavior: on reference you get all the cookies but
// on setting you provide a single cookie and it is added to the list)
function setCookie(key, value) {
  let age = String(60 * 60 * 24 * 7) // one week: kind of arbitrary
  document.cookie = key + "=" + String(value) + ";max-age=" + age
}

// Respond to click of the theme button
function themeClicked() {
    window.colorSetting = (window.colorSetting == "dark") ? "light" : "dark"
    imposeColor(window.colorSetting)
}

// Impose a color scheme.  Called at startup and when theme is clicked
function imposeColor(color) {
    let $white = 'white';
    let $black = 'black'
    $reverseTheme = 'Light';
    if (color == 'light') {
      $white = 'black';
      $black = 'white';
      $reverseTheme = 'Dark';
      editor.setTheme('ace/theme/xcode');
    } else {
      editor.setTheme('ace/theme/terminal');
    }
    elem('themeName').textContent = $reverseTheme;
    elem('input').style.color = $white;
    elem('input').style.background = $black;
    elem('timingText').style.color = $white;
    elem('timingText').style.background = $black;
    elem('resultText').style.color = $white;
    elem('resultText').style.background = $black;
    setCookie(window.colorKey, color)
}

// Get the active session for a given action if present
function getSession(vname) {
  for (i in window.activeSessions) {
    let candidate = window.activeSessions[i]
    if (candidate.name == vname) {
      return candidate
    }
  }
  return null
}

// Impose a specific action on the editor.  Each action that the user has visited or created gets its own session and at most one
// session can exist for each action.  Returns a Promise, which is either the result of calling getCode (truly asynchronous)
// or a vacuous promise that simply continues the resolve chain (if an existing session was used).
// Assumes that the 'language' global variable is correctly initialized for the action.
function imposeAction(vname) {
  // Check whether we already have an ACE EditSession going for the action.  If so, just switch to it.
  let candidate = getSession(vname)
  if (candidate != null) {
    console.log("Used existing session for action " + vname)
    window.editor.setSession(candidate.session)
    imposeWebbiness(candidate.isWeb)
    return Promise.resolve(vname)
  }
  // If we are making a new session, we initialize it here with example code.  This may be overwritten by saved
  // code.  However, if there is no saved code, getCode will do nothing but will resolve to the action name rather
  // than rejecting.  This will leave the sample code in place
  let session = new window.EditSession(language.example)
  session.setMode(language.editMode)
  session.on("change", codeChanged)
  window.activeSessions[window.activeSessions.count] = { name: vname, session: session, isWeb: false }
  window.editor.setSession(session)
  return getCode(vname)
}

// Called when code changes
function codeChanged(delta) {
  window.editorContentsChanged = true
}

// Open a request session to nimbella
function makeOpenWhiskRequest(vname, args) {
  return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest()
      const url = '/actions/'+vname
      xhr.open('POST', url)
      xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
      xhr.onload = function () {
        if (this.status >= 200 && this.status < 300) {
          resolve(xhr.responseText)
          } else {
          console.log("calling reject with status", this.status)
          reject({status: this.status, statusText: xhr.statusText, msg: JSON.parse(this.responseText).msg})
          }
      }
      xhr.onerror = function () {
        console.log("calling reject with network error")
        reject({statusText: "Network error"})
      }
        xhr.send(JSON.stringify(args))
  })
}

// Conditionally save the code from the current editor without actually running it (and only if contents of the editor
// have changed since initialization or last save).  Invoked periodically ("autosave").
function maybeSave() {
  if (window.editorContentsChanged) {
    save(false)
  }
}

// Save the code without running it, either as a standard action or a webaction.   Called for autosaving iff editor contents changed
// and when imposing webbiness or non-webbiness.
function save(web) {
  // elem("run").disabled = true  // Suppress run while saving
  // console.log("Saving editor contents")
  // let contents = window.editor.getValue()
  //   let arg = { code : contents, playgroundId: window.playgroundId, vname: window.currentAction, runtime: window.language.kind }
  //   if (web) {
  //     arg['web-export'] = true
  //   } else {
  //     arg['saveOnly'] = true
  //   }
  //   return makeOpenWhiskRequest('playground-run.json', arg).then(result => {
  //   window.editorContentsChanged = false  // regardless of error.  We don't want to keep trying if it isn't going to work.
  //   elem("run").disabled = false  // Save is over, run is ok
  //   let response = JSON.parse(result)
  //   if ("error" in response) { // this is error as defined by the remote action, not xhr
  //     let error = response.error
  //     console.log("Error response: " + error)
  //   } else if ("saved" in response) { // success
  //     console.log("Saved")
  //   } else {
  //     console.log("Unexpected", response)
  //   }
  //   }).catch(err => {
  //   console.error("Error performing save action", err)
  //   })
}

// Set the contents of a text display area
function setAreaContents(areaID, contents, error) {
  let innerHTML = error ? "<p style=\"color:red\">" + contents + "</p>" : contents
  elem(areaID).innerHTML = innerHTML
}

function get_parameters(vcode){
  let parameters = {}
  let inp_params = vcode.split('(')[1].split(')')[0].split(',')
  console.log("inp_params", inp_params);
  if(inp_params.length <= 1)
    return {}

  for (param of inp_params){
    param = param.trim().split(' ')
		let typ = param[0]
    let nam = param[1]
    parameters[nam] = ""
    if (typ == "int")
      parameters[nam] = Math.floor(Math.random() * 25)
  }
  return parameters
}

function get_action_name(vcode){
  let pieces = vcode.split('(')[0].split(' ')
  return pieces[pieces.length - 1]
}

// Respond to click of the run button
function createClicked() {
  window.editorContentsChanged = false  // don't permit save to run in parallel
  let contents = window.editor.getValue()
    setAreaContents("resultText", "Creating...")
    let t0 = new Date().getTime()
    let inputStr = elem("input").value
    let arg = { vcode : contents, runtime: window.language.kind }
    console.log(arg);
    let vname = window.currentAction

    if (get_action_name(contents)!=vname){
      setAreaContents("resultText", "Name of the action should be same as name of the function", true)
      return
    }

    return makeOpenWhiskRequest(vname+"/create", arg).then(result => {
    let elapsed = new Date().getTime() - t0
    let response = JSON.parse(result)
    if ("error" in response) {
      let msg = response.error.response.result.error // seems the more readable form of the error is buried here
      let inx = msg.indexOf("\n")
      let usermsg = inx > 0 ? msg.substring(0, inx) : msg
      console.log("Error response: " + msg)
      setAreaContents("resultText", eval(usermsg), true)
      setAreaContents("timingText", "", false)
    } else {
      console.log('response: ', response)
      console.log('elapsed: ', elapsed)
      let result = response['result']
      let deploy = response['deployTime']
      let exec = response['runTime']
      let network = elapsed - (deploy + exec)

      if (result.body && result.headers && result.headers['content-type'] == 'image/jpeg') {
        setAreaContents("resultText", '<img src="data:image/png;base64, ' + result.body + '">', false)
      } else {
        setAreaContents("resultText", JSON.stringify(result, null, 4), false)
        let params = get_parameters(contents)
        elem("input").value = JSON.stringify(params, null, 4)
      }

      let timingStr = "Network: " + network + " ms<br>Deploy: " + deploy + " ms<br>Exec: " + exec + " ms"
      setAreaContents("timingText", timingStr, false)
    }
    }).catch(err => {
        console.log("Error contacting service", err)
        setAreaContents("resultText", err.msg + ", status = " + err.status, true)
        setAreaContents("timingText", "", false)
   });
}


// Process a new name entered in the nameInput area
function processNewName() {
  if (window.entryFollowup == null) {
    // Can happen because of cancelling with escape key after some data was entered
    console.log("Not processing new name due to previous cancellation")
    return
  }
  let newName = elem("nameInput").value
  if (newName.trim() == "") {
    // Cancel request
    console.log("Cancel detected as empty name")
    endNameEntry()
    return
  }
  console.log("Processing new name", newName)
  if (isInvalidvname(newName)) {
    postNameError("Invalid name")
  } else if (isConflictingvname(newName)) {
    postNameError("Conflicting Name")
  } else {
    console.log("Valid new name", newName)
    window.entryFollowup(newName) // leave remainder to the individual followups
  }
}

// Check for valid syntax of action name.  Returns true IF INVALID!  Rule:
// The first character must be an alphanumeric character, or an underscore.
// The subsequent characters can be alphanumeric, spaces, or any of the following values: _, @, ., -.
// The last character can't be a space.
function isInvalidvname(newName) {
  if (newName.trim() !== newName) {
    return true
  }
  let valid = /^[0-9a-zA-Z_][ 0-9a-zA-Z_@.-]*$/
  return !valid.test(newName)
}

// Check for conflict between a proposed action name and any existing action in the same package
function isConflictingvname(newName) {
  for (action of window.actionList) {
    if (action.name == newName) {
      return true
    }
  }
  return false
}

// Post an error over the name entry area
function postNameError(msg) {
  console.log("Posting name error", msg)
  let nameInput = elem("nameInput")
  let savedValue = nameInput.value
  let savedColor = nameInput.style.color
  nameInput.style.color = "red"
  nameInput.value = msg
  setTimeout(function() {
    nameInput.value = savedValue
    nameInput.style.color = savedColor
  }, 2000)
}

// abbreviation for document.getElementById
function elem(name) {
  return document.getElementById(name)
}

// Respond to click of the run button
function runClicked() {
  window.editorContentsChanged = false  // don't permit save to run in parallel
  let contents = window.editor.getValue()
    console.log("Contents: ", contents)
    setAreaContents("resultText", "Running...")
    let t0 = new Date().getTime()
    let inputStr = elem("input").value
    let params = null
    try{
      params = JSON.parse(inputStr)
    }catch(e){
      setAreaContents("resultText", "Error parsing input parameters as json", true)
      return
    }
    let arg = { vargs: params, playgroundId: window.playgroundId, vname: window.currentAction, runtime: window.language.kind }
    console.log(arg)
    let vname = window.currentAction

    return makeOpenWhiskRequest(vname+"/invoke", arg).then(result => {
    let elapsed = new Date().getTime() - t0
    let response = JSON.parse(result)
    if ("error" in response) {
      let msg = response.error.response.result.error // seems the more readable form of the error is buried here
      let inx = msg.indexOf("\n")
      let usermsg = inx > 0 ? msg.substring(0, inx) : msg
      console.log("Error response: " + msg)
      setAreaContents("resultText", usermsg, true)
      setAreaContents("timingText", "", false)
    } else {
      console.log('response: ', response)
      console.log('elapsed: ', elapsed)
      let result = response['result']
      let deploy = +parseFloat(response['deployTime']).toFixed(2)
      let exec = +parseFloat(response['runTime']).toFixed(2)
      let network = (elapsed - (deploy + exec)).toFixed(2)

      if (result.body && result.headers && result.headers['content-type'] == 'image/jpeg') {
        setAreaContents("resultText", '<img src="data:image/png;base64, ' + result.body + '">', false)
      } else {
        setAreaContents("resultText", result, false)
      }

      let timingStr = "Network: " + network + " ms<br>Deploy: " + deploy + " ms<br>Exec: " + exec + " ms"
      setAreaContents("timingText", timingStr, false)
    }
    }).catch(err => {
        console.log("Error contacting service", err)
        setAreaContents("resultText", err.msg + ", status = " + err.status, true)
        setAreaContents("timingText", "", false)
   });
}
