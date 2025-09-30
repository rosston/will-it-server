'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { createTodo, getTodos, type Todo } from '../lib/todoActions'

export function Todos () {
  const [todos, setTodos] = useState<Todo[]>([])

  const updateTodos = () => {
    const todosPromise = getTodos() as Promise<Todo[]>
    todosPromise.then(setTodos)
  }

  useEffect(() => {
    updateTodos()
  }, [])

  const handleAddFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formEl = e.target as HTMLFormElement
    if ('todo-input' in formEl.elements) {
      const inputEl = formEl.elements['todo-input'] as HTMLInputElement
      await createTodo(inputEl.value)

      inputEl.value = ''
      updateTodos()
    }
  }

  return (
    <div>
      <h1>Todos</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
      <form onSubmit={handleAddFormSubmit}>
        <input type='text' name='todo-input' />
        <button type='submit'>Add Todo</button>
      </form>
    </div>
  )
}
