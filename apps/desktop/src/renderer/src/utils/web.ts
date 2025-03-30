export class WebApiService {
  private baseUrl = '/'

  async persistenceAction(model: string, action: string, args: any) {
    const res = await fetch(`${this.baseUrl}v1/db`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        action,
        args
      })
    })
    const json = await res.json()
    return json
  }
}
