// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  cell::{Cell, UnsafeCell},
  path::PathBuf,
  rc::Rc,
};

use gtk::{glib::GString, prelude::*};
use webkit2gtk::WebView;

use crate::DragDropEvent;

#[derive(PartialEq, Eq, PartialOrd, Ord, Clone, Copy, Debug)]
enum DragControllerState {
  Entered,
  Leaving,
  Left,
}

struct DragDropController {
  paths: UnsafeCell<Option<Vec<PathBuf>>>,
  state: Cell<DragControllerState>,
  position: Cell<(i32, i32)>,
  drop_pending: Cell<bool>,
  handler: Box<dyn Fn(DragDropEvent) -> bool>,
}

impl DragDropController {
  fn new(handler: Box<dyn Fn(DragDropEvent) -> bool>) -> Self {
    Self {
      handler,
      paths: UnsafeCell::new(None),
      state: Cell::new(DragControllerState::Left),
      position: Cell::new((0, 0)),
      drop_pending: Cell::new(false),
    }
  }

  fn store_paths(&self, paths: Vec<PathBuf>) {
    unsafe { *self.paths.get() = Some(paths) };
  }

  fn take_paths(&self) -> Option<Vec<PathBuf>> {
    unsafe { &mut *self.paths.get() }.take()
  }

  fn store_position(&self, position: (i32, i32)) {
    self.position.replace(position);
  }

  fn enter(&self) {
    self.state.set(DragControllerState::Entered);
  }

  fn leaving(&self) {
    self.state.set(DragControllerState::Leaving);
  }

  fn leave(&self) {
    self.state.set(DragControllerState::Left);
    self.drop_pending.set(false);
    self.take_paths();
  }

  fn state(&self) -> DragControllerState {
    self.state.get()
  }

  /// Called from the `drag-drop` handler: the mouse button was released over
  /// the webview. Data may already have been delivered during the drag
  /// motion, so if it is in store the drop completes here.
  fn drop_started(&self) {
    self.drop_pending.set(true);
  }

  /// Called from `drag-data-received`: returns and clears the pending flag.
  fn take_drop_pending(&self) -> bool {
    let pending = self.drop_pending.get();
    self.drop_pending.set(false);
    pending
  }

  fn call(&self, event: DragDropEvent) -> bool {
    (self.handler)(event)
  }
}

pub(crate) fn connect_drag_event(webview: &WebView, handler: Box<dyn Fn(DragDropEvent) -> bool>) {
  let controller = Rc::new(DragDropController::new(handler));

  {
    let controller = controller.clone();
    webview.connect_drag_data_received(move |_, _, _, _, data, info, _| {
      if info == 2 {
        let uris = data.uris();
        let paths = uris.iter().map(path_buf_from_uri).collect::<Vec<_>>();
        if controller.state() != DragControllerState::Entered {
          controller.enter();
          controller.call(DragDropEvent::Enter {
            paths: paths.clone(),
            position: controller.position.get(),
          });
        }
        controller.store_paths(paths.clone());
        // The drag data can be requested during the motion as well as when
        // the drop completes. Only treat the delivery as a drop when the
        // `drag-drop` handler marked it as one, otherwise files would open
        // before the mouse button is released.
        if controller.take_drop_pending() {
          controller.call(DragDropEvent::Drop {
            paths,
            position: controller.position.get(),
          });
        }
      }
    });
  }

  {
    let controller = controller.clone();
    webview.connect_drag_motion(move |_, _, x, y, _| {
      if controller.state() == DragControllerState::Entered {
        controller.call(DragDropEvent::Over { position: (x, y) });
      } else {
        controller.store_position((x, y));
      }
      false
    });
  }

  {
    let controller = controller.clone();
    webview.connect_drag_drop(move |_, ctx, x, y, time| {
      controller.store_position((x, y));
      controller.drop_started();
      // The drag data may already have been delivered during the motion; in
      // that case the drop completes here. Otherwise `drag-data-received`
      // will fire for the drop and emit it (WebKitGTK requests the data).
      if let Some(paths) = controller.take_paths() {
        ctx.drop_finish(true, time);
        controller.leave();
        return controller.call(DragDropEvent::Drop {
          paths,
          position: (x, y),
        });
      }

      false
    });
  }

  webview.connect_drag_leave(move |_w, _, _| {
    if controller.state() != DragControllerState::Left {
      controller.leaving();
      let controller = controller.clone();
      gtk::glib::idle_add_local_once(move || {
        if controller.state() == DragControllerState::Leaving {
          // The drag was cancelled — discard any buffered paths so a later
          // drop cannot replay them.
          controller.leave();
          controller.call(DragDropEvent::Leave);
        }
      });
    }
  });
}

fn path_buf_from_uri(gstr: &GString) -> PathBuf {
  let path = gstr.as_str();
  let path = path.strip_prefix("file://").unwrap_or(path);
  let path = percent_encoding::percent_decode(path.as_bytes())
    .decode_utf8_lossy()
    .to_string();
  PathBuf::from(path)
}
