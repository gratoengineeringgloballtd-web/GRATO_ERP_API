# Task Recommendation API Endpoints

## Find Best Match
Finds the single best tasker match for a given task.

**Endpoint:** POST `/api/recommendations/match`

**Request Body:**
```json
{
    "category": "cleaning",
    "location": {
        "type": "Point",
        "coordinates": [-122.4194, 37.7749]  // [longitude, latitude]
    },
    "scheduledTime": "2024-01-20T10:00:00Z"
}
```

**Response:**
```json
{
    "tasker": {
        "id": "tasker_id",
        "name": "John Doe",
        "rating": 4.8,
        "skills": ["cleaning"],
        "currentLocation": {
            "type": "Point",
            "coordinates": [-122.4194, 37.7749]
        }
    },
    "distance": 1.5  // distance in kilometers
}
```

## Get Recommendations
Gets multiple recommended taskers for a given task.

**Endpoint:** POST `/api/recommendations/recommend`

**Request Body:**
```json
{
    "task": {
        "category": "cleaning",
        "location": {
            "type": "Point",
            "coordinates": [-122.4194, 37.7749]
        },
        "scheduledTime": "2024-01-20T10:00:00Z"
    },
    "limit": 5  // optional, defaults to 5
}
```

**Response:**
```json
[
    {
        "tasker": {
            "id": "tasker_id",
            "name": "John Doe",
            "rating": 4.8,
            "skills": ["cleaning"],
            "currentLocation": {
                "type": "Point",
                "coordinates": [-122.4194, 37.7749]
            }
        },
        "score": 95.5,
        "distance": 1.5
    }
    // ... more recommendations
]
```

## Testing the API

You can test these endpoints using curl:

```bash
# Find best match
curl -X POST http://localhost:3000/api/recommendations/match \
  -H "Content-Type: application/json" \
  -d '{
    "category": "cleaning",
    "location": {
      "type": "Point",
      "coordinates": [-122.4194, 37.7749]
    },
    "scheduledTime": "2024-01-20T10:00:00Z"
  }'

# Get recommendations
curl -X POST http://localhost:3000/api/recommendations/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "task": {
      "category": "cleaning",
      "location": {
        "type": "Point",
        "coordinates": [-122.4194, 37.7749]
      },
      "scheduledTime": "2024-01-20T10:00:00Z"
    },
    "limit": 5
  }'
```