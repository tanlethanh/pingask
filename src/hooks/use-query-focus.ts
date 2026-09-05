import { type RefObject, useEffect } from 'react'

/** Keeps the caret in the query field. Called by the pages that have one. */
export const useQueryFocus = (
  inputRef: RefObject<HTMLInputElement | null>,
  focused: boolean,
): void => {
  useEffect(() => {
    if (focused) inputRef.current?.focus()
  }, [inputRef, focused])
}
