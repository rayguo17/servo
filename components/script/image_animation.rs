/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

use std::collections::HashMap;
use std::hash::Hasher;
use std::sync::Arc;
use std::thread::{self, Builder};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fxhash::FxHashMap;
use net_traits::request::CorsSettings;
use script_bindings::root::Dom;
use std::cell::Cell;
use libc::c_void;
use parking_lot::RwLock;
use pixels::Image;
use script_layout_interface::{ImageAnimateState, ImageIdentifier, LayoutImageAnimateSet};
use script_traits::UntrustedNodeAddress;
use servo_url::{ImmutableOrigin, ServoUrl};
use style::dom::OpaqueNode;
 
use crate::dom::bindings::cell::DomRefCell;
use crate::dom::bindings::trace::NoTrace;
use crate::dom::node::{from_untrusted_node_address, Node};
use crate::task_source::SendableTaskSource;
 

/*
Remaining questions:
    1. when do we start/pause/resume the image animation timer.
    2. Also How do we mark the start/pause/resume status.
    
*/ 
#[derive(Default, JSTraceable, MallocSizeOf)]
#[cfg_attr(crown, crown::unrooted_must_root_lint::must_root)]
 pub struct ImageAnimationManager {
    /// The Node/Image/State map storage
    #[no_trace]
    pub(crate) set: ImageAnimationSet,
    /// Quick Look up Marker to dertermine whether we will register next image animation timer.
    has_running_animations: Cell<bool>, 
    // node -> [image url + Cors] mappin. (K:OpaqueNode, V:(Option<ServoUrl>,Cors)) gthis should be used in layout to track which node have animated image.
    rooted_nodes: DomRefCell<FxHashMap<NoTrace<OpaqueNode>, Dom<Node>>>, // Which node do we need to update.
    /// last time each node is dirty. (maybe we should track it in each status)
    timeline_value_at_last_dirty: Cell<f64>, 
 }

/* 
    Two use case:
    1. In layout phase, there will be two stage: (We may want to dissect this to two struct )
        a. when fetching the image from image cache during generating box_tree/display_list, we need to check if the image is animated, if yes, we need to check whether the node is in the set.
            1. if it does not exist, we need to add it to the set.
            2. if it does exist, we need to check whether the image is the same as the one in the set.
                a. if it is not the same, we need to change the node_to_image_key mapping to reflect that.
                b. if it is the same, we do nothing.
        b. after the layout, post layout, we need to check whether the node in the set is in the fragment tree. (some node may have been remove.)
            1. if it is not in the fragment tree, we need to remove it from the set.
            2. if it is in the fragment tree, we do nothing.

    2. In Script Thread, we need to check whether we need to:
        a. check whether each image is used by any node in the set.
            1. if it is not used, we need to remove it from the set.
            2. if it is used, we do nothing.
        b. check whether the image is updated.
            1. if it is updated, we need to update the image_state.
            2. if it is not updated, we do nothing.
*/ 
#[derive(Default,Clone, MallocSizeOf)]
pub struct ImageAnimationSet {
   // hashmap for checking whether the node is containing the right picture in layout phase
   #[ignore_malloc_size_of = "Arc is hard"]
   node_to_image_key: Arc<RwLock<HashMap<OpaqueNode, ImageIdentifier>>>,  // should we use RwLock here?
   // (K: (Option<ServoUrl>, Cors), V: ImageState )
   #[ignore_malloc_size_of = "Arc is hard"]
   image_state: Arc<RwLock<HashMap<ImageIdentifier, ImageAnimateState>>>,
//    // hashmap for fast lookup if new image frame is updated which node we need to mark dirty. or maybe we just use the node_to_image_key mapping.
//    image_key_to_node: RwLock<HashMap<ImageIdentifier, OpaqueNode>>, // one key -> multiple node.
}

impl ImageAnimationSet {
    pub fn new() -> Self{
        ImageAnimationSet {
            node_to_image_key: Arc::new(RwLock::new(HashMap::new())),
            image_state: Arc::new(RwLock::new(HashMap::new())),
            // image_key_to_node: RwLock::new(HashMap::new()),
        }
    }
    pub fn to_layout_image_animate_set(&self)-> LayoutImageAnimateSet{
        LayoutImageAnimateSet{
            node_to_image_key: self.node_to_image_key.clone(),
            image_state: self.image_state.clone(),
        }
    }
    // if Option<ServoUrl> is none, we just don't use it.// the problem is that htmlImageElement does not expose such info.
    pub fn check_exist(&self, node:OpaqueNode, identifier: ImageIdentifier) -> bool {
        self.node_to_image_key.read().get(&node) == Some(&identifier)
    }
    
    pub fn register_animation(&self, node: OpaqueNode, url: ImageIdentifier) {
        self.node_to_image_key.write().insert(node, url);
    }
}


// TODO: Respect Throttled, do not register timer if the page is not visible.
impl ImageAnimationManager {
    pub fn new() -> Self {
        ImageAnimationManager {
            rooted_nodes: DomRefCell::new(FxHashMap::default()),
            has_running_animations: Cell::new(false),
            timeline_value_at_last_dirty: Cell::new(0.0),
            set: ImageAnimationSet::new()
        }
    }
    pub fn has_running_image_animation(&self) -> bool {
        self.has_running_animations.get()
    }
    // invoke in document after the reference is updated.   
    pub fn root_new_image_animation_node(&self, node: OpaqueNode, url: ImageIdentifier) {
        
    }
    pub fn cancel_root_for_non_existent_image_animation_node(&self, node: OpaqueNode) {
     
    }
    pub fn maybe_mark_node_as_dirty(&self){ //

    }
    pub fn update_for_new_timeline_value(&self){

    }

}
 
 
//  impl ImageAnimationManager {
 
//     pub fn start(&self, task_source: SendableTaskSource) {
//         let store = self.image_animation_set.clone();
//         //let (ipc_sender, ipc_receiver) = ipc::channel().unwrap();

//         Builder::new()
//             .name("ImageAnimation".to_string())
//             .spawn(move || {
//                 // (Ray)TODO: Should change the type constraint if we need to update the core.
//                 loop {
//                     //TODO: Set the exit condition.
//                     thread::sleep(Duration::from_millis(10));

//                     let inner_store = store.clone();
//                     task_source.queue(task!(handle_image_animation: move ||{
//                         inner_store.update_frame_with_new_timeline_value(Self::get_current_time());
//                     }));
//                 }
//             })
//             .unwrap();
//     }

//     fn get_current_time() -> f64 {
//         SystemTime::now()
//             .duration_since(UNIX_EPOCH)
//             .unwrap_or_default()
//             .as_secs_f64()
//     }
// }
 
//  impl ImageAnimationSet {
 
//      pub fn to_layout_helper(&self) -> LayoutImageAnimateHelper {
//          let mut map = HashMap::new();
//          self.store.read().iter().for_each(|(node, state)| {
//              map.insert((*node,state.image_url.clone()), state.current_active_index);
//          });
//          LayoutImageAnimateHelper { mapping: map }
//      }
 
//      #[allow(unsafe_code)]
//      pub fn update_frame_with_new_timeline_value(&self, new_time_value: f64) {
//          // is new_time_value some kind of duration???
//          // 1. iterate through the hashmap, get the opaque node of those who need to update frame.
//          //
 
//          self.store
//              .write()
//              .iter_mut()
//              .filter(|(_node, state)| {
//                  let current_frame_exist_duration = new_time_value - state.last_update_time;
//                  current_frame_exist_duration >=
//                      state.frames_duration[state.current_active_index].as_secs_f64()
//              })
//              .map(|(node, state)| {
//                  state.next_frame(new_time_value);
//                  node
//              })
//              .for_each(|node| {
//                  // 2. set node dirty for those who need update.
//                  unsafe {
//                      println!("Accessing node address");
//                      let address = UntrustedNodeAddress(node.0 as *const c_void);
//                      let node = from_untrusted_node_address(address);
//                      node.dirty(crate::dom::node::NodeDamage::NodeStyleDamaged);
//                  }
//              });
//      }

//  }
 