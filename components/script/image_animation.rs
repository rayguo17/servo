/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

use std::cell::Cell;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use fxhash::{FxBuildHasher, FxHashMap};
use ipc_channel::ipc::IpcSharedMemory;
use parking_lot::RwLock;
use pixels::Image;
use script_layout_interface::{ImageIdentifier, LayoutImageAnimateSet};
use style::dom::OpaqueNode;
use webrender_api::units::DeviceIntSize;
use webrender_api::{ImageDescriptor, ImageDescriptorFlags, ImageFormat};
use webrender_traits::{ImageUpdate, SerializableImageData};

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
}

/*
    Two use case:
    1. In layout phase, there will be two stage: (We may want to dissect this to two struct )
        a. when fetching the image from image cache, if the image is animated, check whether in set.
            1. if it does not exist, we need to add it to the set.
            2. if it does exist, we need to check whether the image is the same as the one in the set.
                a. if it is not the same, we need to change the node_to_image_key mapping to reflect that.
                b. if it is the same, we do nothing.
        b. after the layout, post layout, we need to check whether the node in the set is in the fragment tree.
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
#[derive(Clone, Default, MallocSizeOf)]
pub struct ImageAnimationSet {
    // hashmap for checking whether the node is containing the right picture in layout phase
    #[ignore_malloc_size_of = "Arc is hard"]
    pub node_to_image_key: Arc<RwLock<FxHashMap<OpaqueNode, ImageIdentifier>>>, // should we use RwLock here?
    // (K: (Option<ServoUrl>, Cors), V: ImageState )
    #[ignore_malloc_size_of = "Arc is hard"]
    pub image_state: Arc<RwLock<FxHashMap<ImageIdentifier, ImageAnimateState>>>,
}

impl ImageAnimationSet {
    pub fn new() -> Self {
        ImageAnimationSet {
            node_to_image_key: Arc::new(RwLock::new(FxHashMap::with_hasher(FxBuildHasher::new()))),
            image_state: Arc::new(RwLock::new(FxHashMap::with_hasher(FxBuildHasher::new()))),
            // image_key_to_node: RwLock::new(HashMap::new()),
        }
    }
    pub fn to_layout_image_animate_set(&self) -> LayoutImageAnimateSet {
        LayoutImageAnimateSet {
            node_to_image_key: self.node_to_image_key.clone(),
        }
    }
}

// TODO: Respect Throttled, do not register timer if the page is not visible.
impl ImageAnimationManager {
    pub fn new() -> Self {
        ImageAnimationManager {
            has_running_animations: Cell::new(false),
            set: ImageAnimationSet::new(),
        }
    }
    // invoke in document after the reference is updated.

    pub fn update_for_new_timeline_value(&self) -> Vec<ImageUpdate> {
        let mut update_images: Vec<ImageUpdate> = vec![];
        let mut store = self.set.image_state.write();

        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64(); // maybe this value should be initiate from outside?

        for image_state in store.values_mut() {
            let image = &image_state.image;
            // Should try to get next frame. then we will update it.
            let time_interval_since_last_update = current_time - image_state.last_update_time;
            let mut tmp = time_interval_since_last_update -
                image
                    .frames
                    .get(image_state.current_active_index)
                    .unwrap()
                    .delay
                    .unwrap()
                    .as_secs_f64();
            let mut next_active_frame_id = image_state.current_active_index;
            while tmp > 0.0 {
                next_active_frame_id = (next_active_frame_id + 1) % image.frames.len();
                tmp -= image
                    .frames
                    .get(next_active_frame_id)
                    .unwrap()
                    .delay
                    .unwrap()
                    .as_secs_f64();
            }
            if next_active_frame_id != image_state.current_active_index {
                let frame = image.frames.get(next_active_frame_id).unwrap();
                // update the image.
                update_images.push(
                    // TODO: Premultiply alpha? maybe do it in advance for all the image frame.
                    ImageUpdate::UpdateImage(
                        image.id.unwrap(),
                        ImageDescriptor {
                            format: ImageFormat::BGRA8,
                            size: DeviceIntSize::new(image.width as i32, image.height as i32),
                            stride: None,
                            offset: 0,
                            flags: ImageDescriptorFlags::ALLOW_MIPMAPS,
                        },
                        SerializableImageData::Raw(IpcSharedMemory::from_bytes(&frame.bytes)),
                    ),
                );
                // we want to pack all the image update together, So it might be better if we return vec.
                image_state.last_update_time = current_time;
                image_state.current_active_index = next_active_frame_id;
            }
        }
        update_images
    }
}

// What do we need during layout phase, to determine which
// Some Considerations: we want to handle these
#[derive(Debug)]
pub struct ImageAnimateState {
    // Is it a good idea to store a Arc<Image> here?
    pub image: Arc<Image>,
    pub current_active_index: usize,
    pub last_update_time: f64,
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
