use std::fmt::Debug;
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};

pub struct NoDebug<T> {
    inner: T,
}

impl<T> Debug for NoDebug<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("skipped").finish()
    }
}

impl<T> From<T> for NoDebug<T> {
    fn from(value: T) -> Self {
        Self { inner: value }
    }
}

impl<T> Deref for NoDebug<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<T> DerefMut for NoDebug<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl<T> Default for NoDebug<T>
where
    T: Default,
{
    fn default() -> Self {
        Self {
            inner: T::default(),
        }
    }
}