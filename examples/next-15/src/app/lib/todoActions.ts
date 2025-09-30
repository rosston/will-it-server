'use server'

import { serverFunction } from 'will-it-server'
import { store } from './store'

export interface Todo extends Record<string, any> {
  id: number;
  text: string;
  completed: boolean;
}

export const getTodos = serverFunction(async function getTodos (): Promise<Todo[]> {
  const todos = store.get('todos')
  return todos || []
})

export const createTodo = serverFunction(async function createTodo (text: string): Promise<Todo> {
  const newTodo = { id: Date.now(), text, completed: false }

  const todos = store.get('todos') || []
  const newTodos = [...todos, newTodo]
  store.set('todos', newTodos)

  return newTodo
})
